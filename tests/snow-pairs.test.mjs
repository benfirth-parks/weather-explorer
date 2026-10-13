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
  assert.equal(f.hst_cm, 30);
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
test("Sunshine's newSnow field is ignored: HN24 comes from the depth change", () => {
  const rows = [];
  for (let h = 24; h >= 0; h--) rows.push(rec(h, {snowHeight: 5 + (24 - h) / 8, newSnow: 4}));
  assert.equal(snowFigures(rows, now, {id: 'fts-sunshine'}).hn24_cm, 3);
});
test('ridge-top stations report no HN24, HST or HS', () => {
  assert.deepEqual(snowFigures(hourly([12]), now, {id: 'fts-vulture'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
  assert.deepEqual(snowFigures(hourly([12]), now, {id: 'fts-simpup'}), {hn24_cm: null, hst_cm: null, hs_cm: null});
});
