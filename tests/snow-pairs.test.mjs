import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR} from '../assets/pair-comparison-data.js';
import {snowFigures, snowPairsMarkdown, round1cm} from '../netlify/functions/_snow-pairs.mjs';
const now = 200 * HOUR;
const rec = (h, values) => ({measurementDateTime: new Date(now - h * HOUR).toISOString(), ...values});
/* Hourly new snow: `perDay[k]` cm spread over day k back from now (k = 0 is the last 24 h). */
function hourly(perDay, hs = 100) {
  const rows = [];
  for (let h = 0; h < 10 * 24; h++) {
    const k = Math.floor(h / 24);
    rows.push(rec(h, {newSnow: k < perDay.length ? perDay[k] / 24 : 0, snowHeight: hs}));
  }
  return rows;
}
test('HN24 is the last 24 h; HST runs back to the first dry day', () => {
  const f = snowFigures(hourly([12, 18, 0.5, 30]), now);
  assert.equal(f.hn24_cm, 13); // 12 cm/24 h plus the hour at exactly 24 h ago, as the table counts it
  assert.equal(f.hst_cm, 31); // 12 + 18 plus the 0.5 cm that opened the storm on the dry day
  assert.equal(f.hs_cm, 100);
});
test('a dry last 24 h gives HST 0', () => {
  const f = snowFigures(hourly([0, 0, 20]), now);
  assert.equal(f.hn24_cm, 0);
  assert.equal(f.hst_cm, 0);
});
test('HS-only station and missing data', () => {
  assert.deepEqual(snowFigures(hourly([10], 87), now, {hn: false}), {hn24_cm: null, hst_cm: null, hs_cm: 87});
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
test('HN24 from the HS change when there is no new-snow sensor, ignoring spikes', () => {
  const rows = [];
  for (let h = 30; h >= 0; h--) rows.push(rec(h, {snowHeight: h > 24 ? 100 : 100 + (24 - h) * 0.3}));
  rows.push(rec(5.5, {snowHeight: 160})); // a 50 cm spike the table drops
  const f = snowFigures(rows, now);
  assert.equal(f.hn24_cm, 7); // 107.2 - 100
  assert.equal(f.hs_cm, 107);
});
test('a falling depth gives HN24 0, not no data', () => {
  const rows = [];
  for (let h = 24; h >= 0; h--) rows.push(rec(h, {snowHeight: 1.3 - (24 - h) * 0.06}));
  assert.equal(snowFigures(rows, now, {id: 'fts-stanley'}).hn24_cm, 0);
});
test("Sunshine's HN24 and HST come from its precip gauge total, 1 mm as 1 cm", () => {
  const rows = [];
  // Dry until 30 h ago, then 0.5 mm an hour: HN24 12 mm, HST 15 mm.
  for (let h = 72; h >= 0; h--) rows.push(rec(h, {precipTotal: 200 + (h < 30 ? (30 - h) * 0.5 : 0), newSnow: 4, snowHeight: 8}));
  const f = snowFigures(rows, now, {id: 'fts-sunshine'});
  assert.deepEqual(f, {hn24_cm: 12, hst_cm: 15, hs_cm: 8, fromGauge: true});
  const md = snowPairsMarkdown([{label: 'Lookout / Sunshine Village', hn: true, ...f}]);
  assert.match(md, /HN24 \*\*12 cm\*\* · HST \*\*15 cm\*\* · HS \*\*8 cm\*\* \(HN24 and HST from the precip gauge, 1 mm = 1 cm\)/);
});
test("Skoki's flat 0.1 new-snow field is ignored: a dry gauge gives HN24 and HST 0", () => {
  const rows = [];
  // Its new-snow field reads 0.1 every 15 min (9.6 a day) whatever the weather; the gauge has been flat.
  for (let q = 240 * 4; q >= 0; q--) rows.push({measurementDateTime: new Date(now - q * HOUR / 4).toISOString(), precipTotal: 420, newSnow: 0.1});
  assert.deepEqual(snowFigures(rows, now, {id: 'fts-skoki'}), {hn24_cm: 0, hst_cm: 0, hs_cm: null, fromGauge: true});
});
test('ridge-top stations report no HN24, HST or HS', () => {
  assert.deepEqual(snowFigures(hourly([12]), now, {id: 'fts-vulture'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
  assert.deepEqual(snowFigures(hourly([12]), now, {id: 'fts-simpup'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
});

test('no-gauge stations take HN from depth, not their flat-zero new-snow field', () => {
  const rows = [];
  for (let h = 48; h >= 0; h--) rows.push(rec(h, {newSnow: 0, precipIncr: 0, snowHeight: h < 8 ? 6 : 2}));
  const f = snowFigures(rows, now, {id: 'fts-bowsummit'});
  assert.equal(f.hn24_cm, 4);
  assert.equal(f.hst_cm, 4);
  assert.equal(snowFigures(rows, now, {id: 'fts-boslo'}).hn24_cm, 0); // a station whose new-snow field is used as-is
});
test('HST is never below HN24 on a depth-only station', () => {
  const rows = [];
  for (let h = 48; h >= 0; h--) rows.push(rec(h, {snowHeight: h < 8 ? 3.7 : 2}));
  const f = snowFigures(rows, now, {id: 'fts-boslo'});
  assert.equal(f.hn24_cm, 2);
  assert.equal(f.hst_cm, 2); // the depth rule's 2 cm threshold alone would give 0
});
