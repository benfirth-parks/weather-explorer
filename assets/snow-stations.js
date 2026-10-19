/* Per-station snow rules shared by the 24 h table's HST cells and the AI summary
   (index.html and mobile.html keep inline copies of these two sets; keep them in step).
   SNOW_EXCLUDED_IDS: ridge-top stations whose HS trace is not meaningful, so they report
   no HS, HN24 or HST. HN_FROM_PRECIP_IDS: stations whose HN24 and HST come from the FTS
   precipitation total instead of a snow sensor, counting 1 mm as 1 cm (the Sunshine, Bow Summit and Skoki AB Env gauges; their "new snow" field is not a snow sensor, e.g. Skoki's reads a flat 0.1 every 15 min). */
export const SNOW_EXCLUDED_IDS = new Set(['fts-bosup', 'fts-lookout', 'fts-simpup', 'fts-vulture', 'fts-whymper']);
export const HN_FROM_PRECIP_IDS = new Set(['fts-sunshine', 'fts-bowprecip', 'fts-skoki']);
