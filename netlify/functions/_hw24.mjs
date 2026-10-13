/* 24h gauge precipitation (HW24), shared by the AI summary's station snapshot and its
   Snow Amounts block. */

/* Stations with no precipitation gauge — mirrors NO_PRECIP_GAUGE_IDS in index.html. */
export const NO_PRECIP_GAUGE_IDS = new Set(["fts-vulture", "fts-simpup", "fts-simplo", "fts-bowsummit"]);
const PC_MAX_STEP = 50;
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/* Computed the same way as the dashboard's 24h station summary table: sum the positive steps
   of the running total (ignoring gauge-service resets and >50 mm jumps), fall back to
   per-interval increments when the total is dead, and reject implausible 24h totals (>150 mm).
   `observations` is the station's last 24 h. */
export function hw24FromObservations(observations) {
  let fromTotal = null, prev = null, totalPts = 0;
  for (const o of observations) {
    const v = num(o.precipTotal);
    if (v === null || v < 0 || v > 5000) continue;
    totalPts += 1;
    if (prev !== null) { const step = v - prev; if (step >= 0 && step <= PC_MAX_STEP) fromTotal = (fromTotal || 0) + step; }
    prev = v;
  }
  if (totalPts >= 2 && fromTotal === null) fromTotal = 0;
  let fromIncr = null;
  for (const o of observations) {
    const v = num(o.precipIncr);
    if (v === null || v < 0 || v > PC_MAX_STEP) continue;
    fromIncr = (fromIncr || 0) + v;
  }
  let total = fromTotal === null ? fromIncr : (fromIncr !== null && fromTotal === 0 && fromIncr > 0 ? fromIncr : fromTotal);
  if (total === null || total < 0 || total > 150) return null;
  return Math.round(total * 10) / 10;
}
