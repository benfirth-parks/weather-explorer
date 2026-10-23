import {HOUR, hnIntervals, hwIntervals, numeric, smoothedHs, HN_FROM_HS_THRESHOLD_CM} from './pair-comparison-data.js';

/* HST (height of storm snow, OGRS): new snow since the start of the current storm, i.e. what a
   storm board cleared at the start of the storm would read now. A storm ends once a 24 h period
   has had less than STORM_BREAK_CM of new snow: HST sums the new snow back to the start of the most
   recent such dry 24 h, so the light snow that opens a storm counts and HST is never below the
   last 24 h's HN. Callers pass the table's own HN24 as `hn24`, and HST is raised to it when the
   rules here come out lower (e.g. the depth rule's 2 cm threshold). Built from the same hourly HN
   as the paired panes where there is a new-snow sensor; depth-only stations use whole 24 h
   blocks of smoothed HS (stormSnowFromDepth below). Hours with no data are
   unknown: a 24 h window containing one never counts as the dry break. Used by the 24 h table
   and the AI summary's snow-by-pair block, so both report the same HST. */
export const STORM_BREAK_H = 24;
export const STORM_BREAK_CM = 1;
export const HST_LOOKBACK_H = 240;

export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H, hn24 = null} = {}) {
  if (!records.some(r => { const v = numeric(r.newSnow); return v !== null && v >= 0 && v <= 50; }))
    return atLeastHn24(stormSnowFromDepth(records, now, lookbackHours), hn24, now);
  return atLeastHn24(stormFromHours(hnIntervals(records, now - lookbackHours * HOUR, now, 1).points), hn24, now);
}

/* Storm total from the precipitation gauge, 1 mm counted as 1 cm, for stations whose HN24 and HST
   come from the FTS precip total (HN_FROM_PRECIP_IDS). Same storm rule, with the break at
   under STORM_BREAK_CM (read as 1 mm) of precipitation in 24 h. */
export function stormPrecip(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H, hn24 = null} = {}) {
  return atLeastHn24(stormFromHours(hwIntervals(records, now - lookbackHours * HOUR, now, 1).points), hn24, now);
}

/* HST is never less than HN24: the last 24 h's snow is all part of the current storm. */
function atLeastHn24(r, hn24, now) {
  if (!Number.isFinite(hn24) || hn24 <= 0) return r;
  const hst = Math.round(hn24 * 10) / 10;
  if (r && r.hst >= hst) return r;
  const since = now - STORM_BREAK_H * HOUR;
  return {hst, start: r && r.start !== null && r.start < since ? r.start : since, partial: r ? r.partial : true};
}

function stormFromHours(hours) {
  if (!hours.some(h => h.y !== null)) return null;
  const n = hours.length, W = STORM_BREAK_H;
  // windowDry(i): the 24 hourly bins ending at i are all known and hold < 1 cm.
  const windowDry = i => {
    if (i - W + 1 < 0) return false;
    let sum = 0;
    for (let j = i - W + 1; j <= i; j++) { if (hours[j].y === null) return false; sum += hours[j].y; }
    return sum < STORM_BREAK_CM;
  };
  // The storm runs from the start of the most recent dry 24 h: snow in that window (under 1 cm)
  // is the storm's opening, not a separate event.
  let first = -1;
  for (let i = n - 1; i >= W - 1; i--) if (windowDry(i)) { first = i - W + 1; break; }
  let total = 0, start = null, partial = first < 0;
  for (let i = Math.max(first, 0); i < n; i++) {
    const v = hours[i].y;
    if (v === null) { partial = true; continue; }
    if (v > 0 && start === null) start = hours[i].start;
    total += v;
  }
  return {hst: Math.round(total * 10) / 10, start, partial};
}

/* Depth-only stations (no new-snow sensor). Their HS wobbles a few cm through the day, and
   summing hour-to-hour rises turns that wobble into phantom storms. So each 24 h block's new
   snow is the change in 3 h-smoothed HS between the same time on consecutive days, which
   cancels the daily cycle, counted only when it reaches HN_FROM_HS_THRESHOLD_CM. A block below
   STORM_BREAK_CM ends the storm, as above. */
function stormSnowFromDepth(records, now, lookbackHours) {
  const smooth = smoothedHs(records.filter(r => Date.parse(r.measurementDateTime) <= now));
  if (!smooth.length) return null;
  const hsAt = t => {
    let best = null;
    for (const p of smooth) if (Math.abs(p.x - t) <= HOUR && (!best || Math.abs(p.x - t) < Math.abs(best.x - t))) best = p;
    return best ? best.y : null;
  };
  let total = 0, start = null;
  for (let k = 0; (k + 1) * 24 <= lookbackHours; k++) {
    const end = now - k * 24 * HOUR, from = end - 24 * HOUR;
    const a = hsAt(from), b = hsAt(end);
    if (a === null || b === null) return k === 0 ? null : {hst: Math.round(total * 10) / 10, start, partial: true};
    const gain = b - a >= HN_FROM_HS_THRESHOLD_CM ? b - a : 0;
    if (gain < STORM_BREAK_CM) return {hst: Math.round(total * 10) / 10, start, partial: false};
    total += gain; start = from;
  }
  return {hst: Math.round(total * 10) / 10, start, partial: true};
}
