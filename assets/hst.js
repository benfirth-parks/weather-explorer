import {HOUR, hnIntervals, hwIntervals, hsValues} from './pair-comparison-data.js';

/* HST (height of storm snow), Ben's rule of 23 Oct 2026: the change in HS (snow depth) over the
   current storm, where the storm is the latest run of precipitation with no gap longer than
   STORM_GAP_H. Precipitation comes from the station's gauge (hourly HW of 0.1 mm or more); a
   station with no gauge falls back to the rises in its HS (the paired panes' HN from depth).
   HST is 0 once STORM_GAP_H have passed with no precipitation, and is never below the HN24 the
   caller passes (the table's 24 h HS change). Hours with no data count toward a gap and mark the
   result partial. Used by the 24 h table and the AI summary's
   snow-by-pair block, so both report the same HST. */
export const STORM_GAP_H = 24;
export const HST_LOOKBACK_H = 240;
/* HS at a time is the median of the valid readings within HS_HALF_WINDOW of it (none later than
   now), which damps the few cm the depth sensors wander through the day. HN24 is HS now minus HS
   24 h ago, 0 when the depth fell (index.html, mobile.html and _snow-pairs.mjs use this rule). */
export const HS_HALF_WINDOW = 1.5 * HOUR;
export function hsMedianAt(hs, t, now = Infinity) {
  const ys = hs.filter(p => Math.abs(p.x - t) <= HS_HALF_WINDOW && p.x <= now).map(p => p.y).sort((a, b) => a - b);
  if (!ys.length) return null;
  const m = ys.length >> 1;
  return ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
}

export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H, hn24 = null} = {}) {
  const hs = hsValues(records.filter(r => Date.parse(r.measurementDateTime) <= now));
  if (!hs.length) return null;
  const hsAt = t => hsMedianAt(hs, t, now);
  const storm = stormPeriod(records, now, lookbackHours);
  let r = {hst: 0, start: null, partial: storm.partial};
  if (storm.start !== null) {
    const a = hsAt(storm.start), b = hsAt(now);
    if (a === null || b === null) r = {hst: 0, start: storm.start, partial: true};
    else r = {hst: Math.max(0, Math.round((b - a) * 10) / 10), start: storm.start, partial: storm.partial};
  }
  return atLeastHn24(r, hn24, now);
}

/* Start of the current storm: walk back from now through the hourly precipitation, and stop at
   the first gap longer than STORM_GAP_H. start is null when no precipitation fell in the last
   STORM_GAP_H hours (no storm). */
export function stormPeriod(records, now, lookbackHours = HST_LOOKBACK_H) {
  const from = now - lookbackHours * HOUR;
  let hours = hwIntervals(records, from, now, 1).points;
  if (!hours.some(h => h.y !== null)) hours = hnIntervals(records, from, now, 1).points;
  if (!hours.some(h => h.y !== null)) return {start: null, partial: true};
  let start = null, gapFrom = now, partial = false;
  for (let i = hours.length - 1; i >= 0; i--) {
    const h = hours[i];
    if (gapFrom - h.end > STORM_GAP_H * HOUR) break;
    if (h.y === null) { partial = true; continue; }
    if (h.y <= 0) continue;
    start = h.start;
    gapFrom = h.start;
  }
  // The storm may have begun before the hours fetched.
  if (start !== null && start - from <= STORM_GAP_H * HOUR) partial = true;
  return {start, partial: start !== null && partial};
}

/* HST is never less than HN24: the last 24 h's snow is all part of the current storm. */
function atLeastHn24(r, hn24, now) {
  if (!Number.isFinite(hn24) || hn24 <= 0) return r;
  const hst = Math.round(hn24 * 10) / 10;
  if (r.hst >= hst) return r;
  const since = now - 24 * HOUR;
  return {hst, start: r.start !== null && r.start < since ? r.start : since, partial: r.partial};
}
