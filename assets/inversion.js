import {BANDS, elevationBand} from './elevation-bands.js';

/* ---- Temperature inversion (Ben, 2026-11-14) ----
   Normally it gets colder with height. When a higher elevation band averages warmer than a
   lower one, a warning note written here in code leads the AI summary and sits at the top of
   the 24 h station summary, so it always appears when the condition holds.

   Rule: hour by hour, take each band's mean air temperature. A pair of bands is inverted in
   an hour when the higher band is at least INVERSION_MIN_C warmer than the lower one. The
   note shows when a pair was inverted for at least INVERSION_MIN_HOURS of the window, or is
   inverted at the newest hour. The note does not grade the inversion (Ben, 2026-11-14:
   "just note the inversion"). */
export const INVERSION_MIN_C = 1;
export const INVERSION_MIN_HOURS = 3;
const HOUR_MS = 3_600_000;
const SITE_UTC_OFFSET_HOURS = -6; /* Alberta clock time, labelled MT */

/* Mean air temperature per UTC hour: { "<hour start ms>": °C }. Readings that are not a
   plausible air temperature are left out. */
export function hourlyTemps(observations) {
  const sums = new Map();
  for (const o of observations || []) {
    const v = o ? o.airTempAvg : null;
    const t = o ? new Date(o.measurementDateTime).getTime() : NaN;
    if (typeof v !== 'number' || !(v > -60 && v < 50) || !Number.isFinite(t)) continue;
    const key = Math.floor(t / HOUR_MS) * HOUR_MS;
    const cur = sums.get(key) || {sum: 0, n: 0};
    cur.sum += v; cur.n += 1;
    sums.set(key, cur);
  }
  const out = {};
  for (const [key, {sum, n}] of sums) out[key] = sum / n;
  return out;
}

/* `series` = [{ elevation_band, hourly }] per station; only the newest `hours` hours that
   both bands report are compared. Returns null when no pair of bands meets the rule, else
   the strongest pair:
   { upper, lower, hours, hours_compared, max_diff_c, max_diff_hour_mt, current,
     current_diff_c }. */
export function detectInversion(series, {hours = 24} = {}) {
  const bandHours = {};
  for (const s of series) {
    if (!s || !s.hourly || !BANDS.includes(s.elevation_band)) continue;
    const byHour = (bandHours[s.elevation_band] ||= new Map());
    for (const [key, v] of Object.entries(s.hourly)) {
      const cur = byHour.get(key) || {sum: 0, n: 0};
      cur.sum += v; cur.n += 1;
      byHour.set(key, cur);
    }
  }
  let best = null;
  for (let i = 0; i < BANDS.length; i += 1) {
    for (let j = i + 1; j < BANDS.length; j += 1) {
      const up = bandHours[BANDS[i]], low = bandHours[BANDS[j]];
      if (!up || !low) continue;
      const keys = [...up.keys()].filter((k) => low.has(k)).sort((a, b) => Number(a) - Number(b)).slice(-hours);
      if (!keys.length) continue;
      const diff = (k) => up.get(k).sum / up.get(k).n - low.get(k).sum / low.get(k).n;
      const inverted = keys.filter((k) => diff(k) >= INVERSION_MIN_C);
      const lastDiff = diff(keys[keys.length - 1]);
      const current = lastDiff >= INVERSION_MIN_C;
      if (inverted.length < INVERSION_MIN_HOURS && !current) continue;
      const peakKey = inverted.reduce((a, b) => (diff(b) > diff(a) ? b : a), inverted[0]);
      const found = {
        upper: BANDS[i],
        lower: BANDS[j],
        hours: inverted.length,
        hours_compared: keys.length,
        max_diff_c: Math.round(diff(peakKey) * 10) / 10,
        max_diff_hour_mt: (new Date(Number(peakKey)).getUTCHours() + SITE_UTC_OFFSET_HOURS + 24) % 24,
        current,
        current_diff_c: Math.round(lastDiff * 10) / 10
      };
      if (!best || found.max_diff_c > best.max_diff_c) best = found;
    }
  }
  return best;
}

/* `stations` = [{ elevation, observations }], each station's readings for the window.
   Used by the AI summary (all Banff stations) and by the 24 h station summary (the stations
   it lists), so both notes follow the same rule. */
export function inversionFromStations(stations, options) {
  return detectInversion((stations || [])
    .filter((s) => s && typeof s.elevation === 'number' && Number.isFinite(s.elevation))
    .map((s) => ({elevation_band: elevationBand(s.elevation), hourly: hourlyTemps(s.observations)})), options);
}

/* The warning line. Starts with "⚠" so pages can style it as a warning. Numbers are bold
   in Markdown. */

export function inversionNoteMarkdown(inv) {
  if (!inv) return '';
  const hh = `${String(inv.max_diff_hour_mt).padStart(2, '0')}:00 MT`;
  const deg = (v) => `**${Math.round(v)} °C**`;
  const tail = inv.current
    ? ` and still are, by ${deg(inv.current_diff_c)} at the latest hour.`
    : `; no longer inverted at the latest hour.`;
  return `⚠ **Temperature inversion:** ${inv.upper} stations averaged warmer than ${inv.lower} stations for **${inv.hours} h** of the last ${inv.hours_compared}, by up to ${deg(inv.max_diff_c)} (around ${hh})${tail}`;
}
