// Port verified scales from ScaleScope (source of truth) into Cadence's
// SCALE_LIBRARY. NO FABRICATION: item text, dimensions and citations are carried
// VERBATIM from scalebase/client/src/data/scales.ts. Only Likert label
// scaffolding is derived as standard presentation. Scales WITHOUT reproducible
// items (metadata-only in ScaleScope) are skipped — Cadence administers items,
// so porting them would mean inventing items. Deduped by name → idempotent.
//
// Usage: node scripts/port-scales-from-scalescope.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCALES_TS = path.resolve(__dirname, '..', '..', 'scalebase', 'client', 'src', 'data', 'scales.ts');
const CADENCE_HTML = path.resolve(__dirname, '..', 'index.html');

function loadScaleScope() {
  let src = fs.readFileSync(SCALES_TS, 'utf8');
  src = src.replace(/^\s*import[^\n]*\n/gm, '')
           .replace(/export\s+const\s+SCALES\s*:\s*Scale\[\]\s*=/, 'globalThis.__SCALES =')
           .replace(/:\s*Scale\[\]/g, '')
           .replace(/export\s+const\s+/g, 'globalThis.__x_');
  const cut = src.indexOf('globalThis.__x_');
  if (cut > 0) src = src.slice(0, cut);
  const g = {};
  new Function('globalThis', src)(g);
  return g.__SCALES;
}

// String-aware bracket matcher: returns the index of the `]` that closes the
// array opened by the first `[` at/after `from`. Ignores brackets inside
// single/double-quoted strings (item texts can contain brackets).
function findArrayClose(s, from) {
  const BACKSLASH = String.fromCharCode(92);
  let depth = 0, started = false, inStr = false, q = '';
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === BACKSLASH) { i++; continue; } if (c === q) inStr = false; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = true; q = c; continue; }
    if (c === '[') { depth++; started = true; }
    else if (c === ']') { depth--; if (started && depth === 0) return i; }
  }
  return -1;
}

const POINT_LABELS = {
  4: ['Strongly disagree', 'Disagree', 'Agree', 'Strongly agree'],
  5: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'],
  6: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Somewhat agree', 'Agree', 'Strongly agree'],
  7: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neither agree nor disagree', 'Somewhat agree', 'Agree', 'Strongly agree'],
};
const likertPoints = (rf) => { const m = String(rf || '').match(/(\d+)\s*-?\s*point/i); return m ? +m[1] : 5; };
const labelsFor = (n) => POINT_LABELS[n] || Array.from({ length: n }, (_, i) => String(i + 1));
function anchorsFor(scale, n, labels) {
  const ra = scale.response_anchors;
  if (ra && /\d/.test(ra)) { const parts = ra.split(/\s*;\s*|\s*…\s*|\s+to\s+/i).map(s => s.trim()).filter(Boolean); if (parts.length >= 2) return [parts[0], parts[parts.length - 1]]; }
  return [`1 = ${labels[0]}`, `${n} = ${labels[n - 1]}`];
}
function buildApa(c) {
  if (!c) return '';
  const vip = [c.volume || '', c.issue ? `(${c.issue})` : '', c.pages ? `, ${c.pages}` : ''].filter(Boolean).join('');
  const tail = c.doi ? ` https://doi.org/${c.doi}` : (c.url ? ` ${c.url}` : '');
  return `${c.authors} (${c.year}). ${c.title}. ${c.journal}${c.volume ? ', ' + vip : ''}.${tail}`.replace(/\s+/g, ' ').trim();
}
const esc = (s) => String(s).split(String.fromCharCode(92)).join(String.fromCharCode(92, 92)).split("'").join(String.fromCharCode(92) + "'");

function toCadence(scale, id) {
  const n = likertPoints(scale.response_format);
  const labels = labelsFor(n);
  const anchors = anchorsFor(scale, n, labels);
  const items = (scale.items || []).map(it => {
    const parts = [`num:${it.num}`, `text:'${esc(it.text)}'`];
    if (it.dimension) parts.push(`dim:'${esc(it.dimension)}'`);
    if (it.reversed) parts.push('reversed:true');
    return `      { ${parts.join(', ')} },`;
  }).join('\n');
  const apa = buildApa(scale.citation);
  const doi = scale.citation && scale.citation.doi;
  return `  {
    id: ${id},
    abbr: '${esc(scale.abbreviation || '')}',
    name: '${esc(scale.name)}',
    domain: '${esc(scale.domain)}',
    items_count: ${scale.total_items || (scale.items || []).length},
    response_format: '${esc(scale.response_format || `${n}-point Likert`)}',
    anchors: [${anchors.map(a => `'${esc(a)}'`).join(', ')}],
    likert_points: ${n},
    likert_labels: [${labels.map(l => `'${esc(l)}'`).join(',')}],
    items: [
${items}
    ],
    citation: {
      apa: '${esc(apa)}',${doi ? `\n      doi: '${esc(doi)}'` : ''}
    },
  },`;
}

// ── Main ──
const scales = loadScaleScope();
let html = fs.readFileSync(CADENCE_HTML, 'utf8');

// Repair any prior bad run that appended blocks after </html>.
const endTag = html.lastIndexOf('</html>');
if (endTag >= 0 && html.length > endTag + 8) html = html.slice(0, endTag + '</html>'.length) + '\n';

const arrOpen = html.indexOf('[', html.indexOf('const SCALE_LIBRARY = '));
const arrClose = findArrayClose(html, arrOpen);
if (arrClose < 0) { console.error('[port] could not locate SCALE_LIBRARY close'); process.exit(1); }
const libText = html.slice(arrOpen, arrClose);

const haveNames = new Set([...libText.matchAll(/name:\s*'([^']*)'/g)].map(m => m[1].toLowerCase()));
const ids = [...libText.matchAll(/\bid:\s*(\d+)/g)].map(m => +m[1]);
let nextId = Math.max(0, ...ids) + 1;

const blocks = [];
for (const s of scales) {
  if (haveNames.has(s.name.toLowerCase())) continue;   // already in Cadence
  if (!s.items || !s.items.length) continue;           // metadata-only → can't administer without inventing items
  blocks.push(toCadence(s, nextId++));
}

if (!blocks.length) { console.log('[port] nothing to add — Cadence already mirrors every item-bearing ScaleScope scale.'); fs.writeFileSync(CADENCE_HTML, html); process.exit(0); }

// Insert before the closing `]` (find the last `},` before it to keep commas clean).
html = html.slice(0, arrClose) + blocks.join('\n') + '\n' + html.slice(arrClose);
fs.writeFileSync(CADENCE_HTML, html);
console.log(`[port] added ${blocks.length} verified scales to Cadence SCALE_LIBRARY (ids ${nextId - blocks.length}–${nextId - 1}). Items + citations verbatim from ScaleScope.`);
