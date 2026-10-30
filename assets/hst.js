import {HOUR, hnIntervals, hsValues} from './pair-comparison-data.js';

/* HN24 and HST, Ben's rules of 30 Oct 2026. HN24 is the sum of the hourly HN over the last 24 h.
   HST is the most HS (snow depth) rose above its level at the start of the current storm at any
   point in the storm, so settlement after that peak is not subtracted and a falling depth does not
   take HST to 0 (Ben, 30 Oct 2026). HST can be less than HN24.
   Hourly HN comes from the HS trace, as in the paired panes' HN bars: a 3 h running median of HS,
   with each rise of 2 cm or more above the last reference level credited to the hour it happened
   in (pair-comparison-data.js hnIntervals). The feeds' "new snow" fields are gauge increments
   (Rn_1), not snow, so they are not used.
   The storm is the latest run of hourly HN with no gap longer than STORM_GAP_H, so HST is 0 only
   once STORM_GAP_H have passed with no new snow (the same time HN24 reaches 0). Hours with no data
   count toward a gap and mark the result partial. Used by the 24 h table and the AI summary's
   snow-by-pair block (index.html and mobile.html keep an inline copy of the HN24 sum), so all
   report the same HN24 and HST. */
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

/* The storm's base is the lowest HS in the STORM_BASE_H before its first hour of HN: hourly HN
   is credited once a 2 cm rise has built up, so the snow had begun before that hour. */
export const STORM_BASE_H = 12;
export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H} = {}) {
  const past = records.filter(r => Date.parse(r.measurementDateTime) <= now);
  const hs = hsValues(past);
  if (!hs.length) return null;
  const hsAt = t => hsMedianAt(hs, t, now);
  const storm = stormPeriod(past, now, lookbackHours);
  if (storm.start === null) return {hst: 0, start: null, partial: storm.partial};
  const levels = ts => ts.map(hsAt).filter(v => v !== null);
  const base = levels([storm.start, ...hs.filter(p => p.x < storm.start && p.x >= storm.start - STORM_BASE_H * HOUR).map(p => p.x)]);
  const during = levels([now, ...hs.filter(p => p.x >= storm.start).map(p => p.x)]);
  if (!base.length || !during.length) return {hst: 0, start: storm.start, partial: true};
  const rise = Math.max(...during) - Math.min(...base);
  return {hst: Math.max(0, Math.round(rise * 10) / 10), start: storm.start, partial: storm.partial};
}

/* Start of the current storm: walk back from now through the hourly HN, and stop at the first gap
   longer than STORM_GAP_H. start is null when no new snow fell in the last STORM_GAP_H hours. */
export function stormPeriod(records, now, lookbackHours = HST_LOOKBACK_H) {
  const from = now - lookbackHours * HOUR;
  const hours = hourlyHn(records, from, now).points;
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
