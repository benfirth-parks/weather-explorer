import test from 'node:test';
import assert from 'node:assert/strict';
import {detectInversion, hourlyTemps, inversionNoteMarkdown} from '../netlify/functions/_ai-summary.mjs';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 14, 0); /* 18:00 MT Nov 13 */
const series = (band, temps) => ({elevation_band: band, hourly: Object.fromEntries(temps.map((v, i) => [T0 + i * H, v]))});

test('hourlyTemps averages readings within each hour', () => {
  const out = hourlyTemps([
    {measurementDateTime: new Date(T0).toISOString(), airTempAvg: -4},
    {measurementDateTime: new Date(T0 + 30 * 60000).toISOString(), airTempAvg: -6},
    {measurementDateTime: new Date(T0 + H).toISOString(), airTempAvg: null}
  ]);
  assert.deepEqual(out, {[T0]: -5});
});

test('no note with a normal lapse rate', () => {
  assert.equal(detectInversion([series('Alpine', [-10, -11, -12, -12]), series('Below treeline', [-3, -4, -5, -5])]), null);
  assert.equal(inversionNoteMarkdown(null), '');
});

test('alpine warmer than the valley overnight, cleared by the latest hour', () => {
  const inv = detectInversion([
    series('Alpine', [-8, -4, -3, -2, -8]),
    series('Alpine', [-8, -4, -3, -4, -8]),
    series('Below treeline', [-5, -8, -9, -10, -4])
  ]);
  assert.deepEqual(inv, {upper: 'Alpine', lower: 'Below treeline', hours: 3, hours_compared: 5, max_diff_c: 7, max_diff_hour_mt: 21, current: false, current_diff_c: -4});
  assert.equal(inversionNoteMarkdown(inv),
    '⚠ **Temperature inversion:** Alpine stations averaged warmer than Below treeline stations for **3 h** of the last 5, by up to **7 °C** (around 21:00 MT); no longer inverted at the latest hour.');
});

test('a short inversion still counts while it is on at the latest hour', () => {
  const inv = detectInversion([series('Treeline', [-6, -6, -2]), series('Below treeline', [-3, -4, -5])]);
  assert.equal(inv.hours, 1);
  assert.equal(inv.current, true);
  assert.match(inversionNoteMarkdown(inv), /and still are, by \*\*3 °C\*\* at the latest hour\.$/);
});

test('under 1 °C, or under 3 h and over, is not flagged', () => {
  assert.equal(detectInversion([series('Alpine', [-4.5, -4.5, -4.5, -4.5]), series('Treeline', [-5, -5, -5, -5])]), null);
  assert.equal(detectInversion([series('Alpine', [-2, -2, -9, -9]), series('Treeline', [-5, -5, -5, -5])]), null);
});
