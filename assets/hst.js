import {HOUR, hnIntervals, hsValues} from './pair-comparison-data.js';

/* HN24 and HST, Ben's rules of 30 Oct 2026. HN24 is the sum of the hourly HN over the last 24 h.
   HST is the most HS (snow depth) rose above its level at the start of the current storm at any
   point in the storm, so settlement after that peak is not subtracted and a falling depth does not
   take HST to 0 (Ben, 30 Oct 2026). HST is never less than HN24 (Ben, 7 Nov 2026).
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

/* Hourly HN (cm) from HS between from and to, ignoring any "new snow" field. gaugeCheck (stations in
   HN_GAUGE_CHECK_IDS, pair-comparison-data.js) counts a depth rise only when the gauge confirms it or the RDPS
   forecast (`forecast`, assets/rdps.js) expected precipitation, with a depth-only fallback while the gauge is
   stuck (Ben, 3-4 Nov 2026). */
export function hourlyHn(records, from, to, {gaugeCheck = false, forecast = null} = {}) {
  return hnIntervals(records.map(r => ({...r, newSnow: null})), from, to, 1, {gaugeCheck, gaugeRecords: records, forecast});
}
/* HN24: the sum of the hourly HN over the last 24 h, null with no HS in that time. */
export function newSnow24h(records, now = Date.now(), {gaugeCheck = false, forecast = null} = {}) {
  return hourlyHn(records, now - 24 * HOUR, now, {gaugeCheck, forecast}).total;
}

/* The storm's base is the lowest HS in the STORM_BASE_H before its first hour of HN: hourly HN
   is credited once a 2 cm rise has built up, so the snow had begun before that hour.
   HST is capped at the storm's counted hourly HN (Ben, 7 Nov 2026). A depth sensor can sag a few cm on a warm
   afternoon and bounce back (Sunshine, 5 Nov 2026: 20 cm, down to 16, back to 21 by midnight); the 12 h low
   then sat at the bottom of the sag and the bounce-back read as storm snow (HST 6 cm from 2 cm of HN). The
   HN ratchet and the gauge/RDPS check already drop such rises, so a rise HN did not count does not count
   toward HST either. In a real storm the hourly HN adds up to at least the peak rise, so the cap leaves it
   alone. */
export const STORM_BASE_H = 12;
export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H, gaugeCheck = false, forecast = null} = {}) {
  const past = records.filter(r => Date.parse(r.measurementDateTime) <= now);
  const hs = hsValues(past);
  if (!hs.length) return null;
  const hsAt = t => hsMedianAt(hs, t, now);
  const storm = stormPeriod(past, now, lookbackHours, {gaugeCheck, forecast});
  if (storm.start === null) return {hst: 0, start: null, partial: storm.partial};
  const levels = ts => ts.map(hsAt).filter(v => v !== null);
  const base = levels([storm.start, ...hs.filter(p => p.x < storm.start && p.x >= storm.start - STORM_BASE_H * HOUR).map(p => p.x)]);
  const during = levels([now, ...hs.filter(p => p.x >= storm.start).map(p => p.x)]);
  if (!base.length || !during.length) return {hst: 0, start: storm.start, partial: true};
  // Never below HN24 (Ben, 7 Nov 2026): settling between snowfalls can leave the peak rise under the new snow
  // counted in the last 24 h (Bosworth Lower, 7 Nov: HN24 6, peak rise 4).
  const hn24 = newSnow24h(past, now, {gaugeCheck, forecast}) ?? 0;
  const rise = Math.max(Math.min(Math.max(...during) - Math.min(...base), storm.hn), hn24);
  return {hst: Math.max(0, Math.round(rise * 10) / 10), start: storm.start, partial: storm.partial};
}

/* Start of the current storm: walk back from now through the hourly HN, and stop at the first gap
   longer than STORM_GAP_H. start is null when no new snow fell in the last STORM_GAP_H hours. hn is the hourly
   HN counted from start to now (cm). */
export function stormPeriod(records, now, lookbackHours = HST_LOOKBACK_H, {gaugeCheck = false, forecast = null} = {}) {
  const from = now - lookbackHours * HOUR;
  const hours = hourlyHn(records, from, now, {gaugeCheck, forecast}).points;
  if (!hours.some(h => h.y !== null)) return {start: null, partial: true, hn: 0};
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
  const hn = start === null ? 0 : hours.filter(h => h.start >= start && h.y > 0).reduce((s, h) => s + h.y, 0);
  return {start, partial: start !== null && partial, hn};
}
