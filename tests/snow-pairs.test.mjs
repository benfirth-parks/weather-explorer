import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR} from '../assets/pair-comparison-data.js';
import {snowFigures, snowPairsMarkdown, round5} from '../netlify/functions/_snow-pairs.mjs';
const now = 200 * HOUR;
const rec = (h, values) => ({measurementDateTime: new Date(now - h * HOUR).toISOString(), ...values});
/* Hourly new snow: `perDay[k]` cm spread over day k back from now (k = 0 is the last 24 h). */
function hourly(perDay, hs = 100) {
  const rows = [];
  for (let h = 0; h < 7 * 24 + 6; h++) {
    const k = Math.floor(h / 24);
    rows.push(rec(h, {newSnow: k < perDay.length ? perDay[k] / 24 : 0, snowHeight: hs}));
  }
  return rows;
}
test('HN24 is the last 24 h; HST runs back to the first dry day', () => {
  const f = snowFigures(hourly([12, 18, 0.5, 30]), now);
  assert.equal(f.hn24_cm, 10);
  assert.equal(f.hst_cm, 30);
  assert.equal(f.hs_cm, 100);
});
test('a dry last 24 h gives HST 0', () => {
  const f = snowFigures(hourly([0, 20]), now);
  assert.equal(f.hn24_cm, 0);
  assert.equal(f.hst_cm, 0);
});
test('HS-only station and missing data', () => {
  assert.deepEqual(snowFigures(hourly([10], 87), now, {hn: false}), {hn24_cm: null, hst_cm: null, hs_cm: 85});
  assert.deepEqual(snowFigures([], now), {hn24_cm: null, hst_cm: null, hs_cm: null});
  assert.equal(round5(12.4), 10);
  assert.equal(round5(12.5), 15);
});
test('markdown block lists every pair', () => {
  const md = snowPairsMarkdown([
    {label: 'Simpson Upper / Lower', hn: true, hn24_cm: 5, hst_cm: 20, hs_cm: null},
    {label: 'Lookout / Sunshine Village', hn: false, hn24_cm: null, hst_cm: null, hs_cm: 85}
  ]);
  assert.equal(md, '**Snow Amounts** (observed, nearest 5 cm)\n- Simpson Upper / Lower: HN24 **5 cm** · HST **20 cm** · HS no data\n- Lookout / Sunshine Village: HS **85 cm** (no HN sensor)');
});
