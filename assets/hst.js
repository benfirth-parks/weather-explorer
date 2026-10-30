import {HOUR, hnIntervals, hwIntervals} from './pair-comparison-data.js';

/* HN24 and HST, Ben's rule of 30 Oct 2026: both are the sum of the hourly HN over their period.
   Hourly HN comes from the HS (snow depth) trace, as in the paired panes' HN bars when a station has
   no new-snow sensor: a 3 h running median of HS, with each rise of 2 cm or more above the last
   reference level credited to the hour it happened in (pair-comparison-data.js hnIntervals). The
   feeds' "new snow" fields are gauge increments (Rn_1), not snow, so they are not used.
   HN24 sums the last 24 hours. HST sums the hours since the current storm began, where the storm is
   the latest run of precipitation with no gap longer than STORM_GAP_H. Precipitation comes from the
   station's gauge (hourly HW of 0.1 mm or more); a station with no gauge uses its hourly HN.
   HST is 0 once STORM_GAP_H have passed with no precipitation, and is never below the HN24 the
   caller passes. Hours with no data count toward a gap and mark the result partial. Used by the
   24 h table and the AI summary's snow-by-pair block (index.html and mobile.html keep an inline
   copy of the HN24 sum), so all report the same HN24 and HST. */
export const STORM_GAP_H = 24;
export const HST_LOOKBACK_H = 240;
/* HS at a time is the median of the valid readings within HS_HALF_WINDOW of it (none later than
   now), which damps the few cm the depth sensors wander through the day. */
export const HS_HALF_WINDOW = 1.5 * HOUR;
export function hsMedianAt(hs, t, now = Infinity) {
  const ys = hs.filter(p => Math.abs(p.x - t) <= HS_HALF_WINDOW && p.x <= now).map(p => p.y).sort((a, b) => a - b);
  if (!ys.length) return null;
  const m = ys.length >> 1;
  return ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
}

/* Hourly HN (cm) from HS between from and to, ignoring any "new snow" field. */
export function hourlyHn(records, from, to) {
  return hnIntervals(records.map(r => ({...r, newSnow: null})), from, to, 1);
}
/* HN24: the sum of the hourly HN over the last 24 h, null with no HS in that time. */
export function newSnow24h(records, now = Date.now()) {
  return hourlyHn(records, now - 24 * HOUR, now).total;
}

export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H, hn24 = null} = {}) {
  const past = records.filter(r => Date.parse(r.measurementDateTime) <= now);
  const hn = hourlyHn(past, now - lookbackHours * HOUR, now);
  if (hn.total === null) return null;
  const storm = stormPeriod(past, now, lookbackHours);
  let r = {hst: 0, start: null, partial: storm.partial};
  if (storm.start !== null) {
    const hours = hn.points.filter(h => h.end > storm.start);
    const total = hours.reduce((s, h) => s + (h.y ?? 0), 0);
    r = {hst: Math.round(total * 10) / 10, start: storm.start, partial: storm.partial || hours.some(h => h.y === null)};
  }
  return atLeastHn24(r, hn24, now);
}

/* Start of the current storm: walk back from now through the hourly precipitation, and stop at
   the first gap longer than STORM_GAP_H. start is null when no precipitation fell in the last
   STORM_GAP_H hours (no storm). */
export function stormPeriod(records, now, lookbackHours = HST_LOOKBACK_H) {
  const from = now - lookbackHours * HOUR;
  let hours = hwIntervals(records, from, now, 1).points;
  if (!hours.some(h => h.y !== null)) hours = hourlyHn(records, from, now).points;
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
