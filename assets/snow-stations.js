/* Per-station snow rules shared by the 24 h table's HST cells and the AI summary
   (index.html and mobile.html keep inline copies of these sets; keep them in step).
   HN24 and HST come from HS at every station (assets/hst.js); the feeds' "new snow" fields are
   gauge increments, not snow. SNOW_EXCLUDED_IDS: ridge-top stations whose HS trace is not
   meaningful, so they report no HS, HN24 or HST. */
export const SNOW_EXCLUDED_IDS = new Set(['fts-bosup', 'fts-lookout', 'fts-simpup', 'fts-vulture', 'fts-whymper']);
/* HN_FROM_DEPTH_IDS: stations with no precipitation gauge whose feed still carries "new snow" and
   precip fields, which are the gauge increment (Rn_1) and so read a flat 0. They are dropped, so the
   HN graphs and the storm timing come from the snow depth sensor (index.html and mobile.html keep inline copies). */
export const HN_FROM_DEPTH_IDS = new Set(['fts-bowsummit', 'fts-simplo']);
export function withoutFalseNewSnow(id, records) {
  return HN_FROM_DEPTH_IDS.has(id) ? records.map(r => ({...r, newSnow: null, precipIncr: null, precipTotal: null})) : records;
}
/* NO_SNOW_SENSOR_IDS: precipitation-gauge stations with no working snow depth sensor (Skoki and
   Boulder Creek, Lake Louise and Vermillion Crossing Fire report no depth; Castle Fire's depth reads
   about -180 to -220 cm). Ben, 23 Oct 2026: they show no HN24, HST or HS; HW is unchanged.
   index.html and mobile.html keep inline copies. */
export const NO_SNOW_SENSOR_IDS = new Set(['fts-skoki', 'fts-lakelouise', 'fts-boulder', 'fts-castle', 'fts-vermillion']);
