import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR} from '../assets/pair-comparison-data.js';
import {snowFigures, snowPairsMarkdown, round1cm} from '../netlify/functions/_snow-pairs.mjs';
const now = 200 * HOUR;
const rec = (h, values) => ({measurementDateTime: new Date(now - h * HOUR).toISOString(), ...values});
/* Hourly records: `rain` maps hours-ago -> mm in that hour, `hs(h)` gives HS h hours ago. */
function hourly(rain, hs, hours = 240) {
  const rows = [];
  let total = 200;
  for (let h = hours - 1; h >= 0; h--) {
    total += rain[h] ?? 0;
    rows.push(rec(h, {precipTotal: Math.round(total * 10) / 10, newSnow: rain[h] ?? 0, snowHeight: hs(h)}));
  }
  return rows;
}
test('HN24 sums the hourly HN over 24 h; HST over the storm since precipitation began', () => {
  // Precipitation from 40 h ago to 2 h ago, no gap over 24 h; HS 80 -> 92 -> 100.
  const f = snowFigures(hourly({40: 3, 30: 2, 10: 4, 2: 1}, h => (h > 40 ? 80 : h > 20 ? 92 : 100)), now);
  assert.equal(f.hn24_cm, 8);
  assert.equal(f.hst_cm, 20);
  assert.equal(f.hs_cm, 100);
});
test('no precipitation in the last 24 h gives HST 0', () => {
  const f = snowFigures(hourly({50: 10}, h => (h > 50 ? 80 : 95)), now);
  assert.equal(f.hn24_cm, 0);
  assert.equal(f.hst_cm, 0);
});
test("Sunshine: HN24 and HST from hourly HN off HS, not the gauge's 1 mm = 1 cm", () => {
  // 0.5 mm an hour for the last 30 h, while HS rose 8 cm. The 2 cm rise credited just after
  // 24 h ago began before it, so HN24 is 7 rather than the 6 cm HS change.
  const rain = {};
  for (let h = 0; h < 30; h++) rain[h] = 0.5;
  const f = snowFigures(hourly(rain, h => (h >= 30 ? 50 : 58 - Math.round(h / 30 * 8))), now, {id: 'fts-sunshine'});
  assert.equal(f.hst_cm, 8);
  assert.equal(f.hn24_cm, 7);
  assert.equal(f.hs_cm, 58);
  assert.doesNotMatch(snowPairsMarkdown([{label: 'Lookout / Sunshine Village', hn: true, ...f}]), /precip gauge/);
});
test('HS-only station and missing data', () => {
  assert.deepEqual(snowFigures(hourly({2: 1}, () => 87), now, {hn: false}), {hn24_cm: null, hst_cm: null, hs_cm: 87});
  assert.deepEqual(snowFigures([], now), {hn24_cm: null, hst_cm: null, hs_cm: null});
  assert.equal(round1cm(12.4), 12);
  assert.equal(round1cm(12.5), 13);
});
test('markdown block lists every pair', () => {
  const md = snowPairsMarkdown([
    {label: 'Simpson Upper / Lower', hn: true, hn24_cm: 5, hst_cm: 20, hs_cm: null},
    {label: 'Lookout / Sunshine Village', hn: false, hn24_cm: null, hst_cm: null, hs_cm: 87}
  ]);
  assert.equal(md, '**Snow Amounts** (observed, nearest 1 cm)\n- Simpson Upper / Lower: HN24 **5 cm** · HST **20 cm** · HS no data\n- Lookout / Sunshine Village: HS **87 cm** (no HN sensor)');
});
test('HN24 sums the hourly HN from HS, ignoring spikes and the new-snow field', () => {
  const rows = [];
  for (let h = 30; h >= 0; h--) rows.push(rec(h, {snowHeight: h > 24 ? 100 : 100 + (24 - h) * 0.3}));
  rows.push(rec(5.5, {snowHeight: 160})); // a 50 cm spike the table drops
  const f = snowFigures(rows, now);
  assert.equal(f.hn24_cm, 6); // three 2 cm rises; the last 1.2 cm has not reached the 2 cm step
  assert.equal(f.hs_cm, 107);
});
test('a falling depth gives HN24 0, not no data', () => {
  const rows = [];
  for (let h = 24; h >= 0; h--) rows.push(rec(h, {snowHeight: 1.3 - (24 - h) * 0.06}));
  assert.equal(snowFigures(rows, now, {id: 'fts-stanley'}).hn24_cm, 0);
});
test('gauge stations with no snow depth sensor report no HN24, HST or HS', () => {
  const rows = [];
  for (let q = 240 * 4; q >= 0; q--) rows.push({measurementDateTime: new Date(now - q * HOUR / 4).toISOString(), precipTotal: 420 + q / 100, newSnow: 0.1});
  for (const id of ['fts-skoki', 'fts-lakelouise', 'fts-boulder', 'fts-castle', 'fts-vermillion'])
    assert.deepEqual(snowFigures(rows, now, {id}), {hn24_cm: null, hst_cm: null, hs_cm: null});
});
test('ridge-top stations report no HN24, HST or HS', () => {
  assert.deepEqual(snowFigures(hourly({2: 5}, () => 50), now, {id: 'fts-vulture'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
  assert.deepEqual(snowFigures(hourly({2: 5}, () => 50), now, {id: 'fts-simpup'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
});

test('no-gauge stations take HN from depth, not their flat-zero new-snow field', () => {
  const rows = [];
  for (let h = 48; h >= 0; h--) rows.push(rec(h, {newSnow: 0, precipIncr: 0, snowHeight: h < 8 ? 6 : 2}));
  const f = snowFigures(rows, now, {id: 'fts-bowsummit'});
  assert.equal(f.hn24_cm, 4);
  assert.equal(f.hst_cm, 4);
});
test('a depth rise under 2 cm is no hourly HN, so no HN24 or HST', () => {
  const rows = [];
  for (let h = 48; h >= 0; h--) rows.push(rec(h, {snowHeight: h < 8 ? 3.7 : 2}));
  const f = snowFigures(rows, now, {id: 'fts-boslo'});
  assert.equal(f.hn24_cm, 0);
  assert.equal(f.hst_cm, 0);
});
test('HN24 and HST ignore settlement after the peak', () => {
  // 10 cm in the storm 20 to 15 h ago, then 4 cm of settlement over the last 12 h: the HS change is 6.
  const rows = [];
  for (let h = 48; h >= 0; h--) rows.push(rec(h, {snowHeight: h > 20 ? 50 : h > 15 ? 50 + (20 - h) * 2 : h > 12 ? 60 : 60 - (12 - h) / 3}));
  const f = snowFigures(rows, now, {id: 'fts-boslo'});
  assert.equal(f.hn24_cm, 10);
  assert.equal(f.hst_cm, 10); // peak 60 - 50
});
