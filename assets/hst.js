import {HOUR, hnIntervals} from './pair-comparison-data.js';

/* HST (height of storm snow, OGRS): new snow accumulated since the start of the current storm,
   i.e. what a storm board cleared at the start of the storm would read now. Built from the hourly
   HN increments used elsewhere (new-snow sensor, else rises in smoothed HS). A storm starts with the
   first hour of new snow after a dry break and ends after STORM_BREAK_H hours with no new snow.
   Hours with no data are unknown, not dry, so they never end a storm on their own. */
export const STORM_BREAK_H = 24;
export const HST_LOOKBACK_H = 240;

export function stormSnow(records, now = Date.now(), {breakHours = STORM_BREAK_H, lookbackHours = HST_LOOKBACK_H} = {}) {
  const from = now - lookbackHours * HOUR;
  const hours = hnIntervals(records, from, now, 1).points;
  if (!hours.some(h => h.y !== null)) return null;
  // Newest hour with snow.
  let last = -1;
  for (let i = hours.length - 1; i >= 0; i--) if (hours[i].y > 0) { last = i; break; }
  if (last < 0) return {hst: 0, start: null, end: null, ongoing: false, partial: false};
  const ongoing = (now - hours[last].end) < breakHours * HOUR;
  // Walk back from it until a dry break of breakHours.
  let total = 0, start = last, dry = 0, partial = false, found = false;
  for (let i = last; i >= 0; i--) {
    const v = hours[i].y;
    if (v === null) { partial = true; continue; }
    if (v > 0) { total += v; start = i; dry = 0; }
    else if (++dry >= breakHours) { found = true; break; }
  }
  return {
    hst: Math.round(total * 10) / 10,
    start: hours[start].start,
    end: ongoing ? null : hours[last].end,
    ongoing,
    // No dry break inside the lookback: the storm may have started earlier than we can see.
    partial: partial || !found
  };
}
