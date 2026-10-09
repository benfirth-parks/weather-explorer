import {HOUR, hnIntervals} from './pair-comparison-data.js';

/* HST (height of storm snow, OGRS): new snow since the start of the current storm, i.e. what a
   storm board cleared at the start of the storm would read now. A storm ends once a 24 h period
   has had less than STORM_BREAK_CM of new snow, so HST is 0 when the last 24 h were dry, and
   otherwise sums the new snow back to the most recent such dry 24 h. Built from the same hourly HN
   as the paired panes (new-snow sensor, else rises in smoothed HS). Hours with no data are
   unknown: a 24 h window containing one never counts as the dry break. Used by the 24 h table
   and the AI summary's snow-by-pair block, so both report the same HST. */
export const STORM_BREAK_H = 24;
export const STORM_BREAK_CM = 1;
export const HST_LOOKBACK_H = 240;

export function stormSnow(records, now = Date.now(), {lookbackHours = HST_LOOKBACK_H} = {}) {
  const hours = hnIntervals(records, now - lookbackHours * HOUR, now, 1).points;
  if (!hours.some(h => h.y !== null)) return null;
  const n = hours.length, W = STORM_BREAK_H;
  // windowDry(i): the 24 hourly bins ending at i are all known and hold < 1 cm.
  const windowDry = i => {
    if (i - W + 1 < 0) return false;
    let sum = 0;
    for (let j = i - W + 1; j <= i; j++) { if (hours[j].y === null) return false; sum += hours[j].y; }
    return sum < STORM_BREAK_CM;
  };
  if (windowDry(n - 1)) return {hst: 0, start: null, partial: false};
  let brk = -1;
  for (let i = n - 2; i >= W - 1; i--) if (windowDry(i)) { brk = i; break; }
  let total = 0, start = null, partial = brk < 0;
  for (let i = brk + 1; i < n; i++) {
    const v = hours[i].y;
    if (v === null) { partial = true; continue; }
    if (v > 0 && start === null) start = hours[i].start;
    total += v;
  }
  return {hst: Math.round(total * 10) / 10, start, partial};
}
