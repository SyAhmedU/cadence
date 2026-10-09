# cadence


## 2026-10-10 — Latest-data control

A non-destructive **↻ Latest data** panel checks this app's named published reference files and searches current Crossref journal-article metadata. Source/build dates are distinguished from the time of checking; failed checks retain previous successful evidence. Fetched files and metadata can be downloaded. It never clears saved work, resets survey responses, replaces selected scales, regenerates AI text or reloads the current workspace. Curated catalogues, full corpus harvests, publisher policies and current Scopus verification require their separate maintained source workflows. Existing in-memory results remain unchanged.

Canonical source/config: `research-suite/tools/refresh/{research-refresh.js,install.mjs}` in the sibling repository. Run the installer after changes; local script copies are shipped per app. Generated service workers bypass explicit no-store/research_refresh requests.
