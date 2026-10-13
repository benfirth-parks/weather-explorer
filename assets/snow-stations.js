/* Per-station snow rules shared by the 24 h table's HST cells and the AI summary
   (index.html and mobile.html keep inline copies of these two sets; keep them in step).
   SNOW_EXCLUDED_IDS: ridge-top stations whose HS trace is not meaningful, so they report
   no HS, HN24 or HST. HN_FROM_HS_IDS: stations whose newSnow field is not interval new snow
   (Sunshine's AB Env feed), so HN comes from the depth trace instead. */
export const SNOW_EXCLUDED_IDS = new Set(['fts-bosup', 'fts-lookout', 'fts-simpup', 'fts-vulture', 'fts-whymper']);
export const HN_FROM_HS_IDS = new Set(['fts-sunshine']);

/* The records to compute HN from: without newSnow where that field is not usable. */
export function hnRecords(id, records) {
  return HN_FROM_HS_IDS.has(id) ? records.map(({newSnow, ...rest}) => rest) : records;
}
