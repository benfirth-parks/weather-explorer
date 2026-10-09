import test from 'node:test';
import assert from 'node:assert/strict';
import {stormSnow} from '../assets/hst.js';
import {HOUR} from '../assets/pair-comparison-data.js';

const NOW = Date.UTC(2026, 0, 20, 7); // MST midnight, on an hour boundary
/* Hourly new-snow sensor readings: `snow` maps hours-ago -> cm, every other hour reads 0. */
function sensor(snow, hours = 240) {
  const out = [];
  for (let h = hours - 1; h >= 0; h--) out.push({measurementDateTime: new Date(NOW - h * HOUR).toISOString(), newSnow: snow[h] ?? 0});
  return out;
}

test('an ongoing storm totals all snow since the last dry 24 h', () => {
  const r = stormSnow(sensor({2: 3, 10: 5, 30: 4, 40: 2, 70: 9}), NOW);
  assert.equal(r.hst, 14); // 3 + 5 + 4 + 2; the 9 cm fell before 30 dry hours
  assert.equal(r.partial, false);
});
test('a dry spell shorter than 24 h does not end the storm', () => {
  assert.equal(stormSnow(sensor({1: 2, 20: 3}), NOW).hst, 5);
});
test('a 24 h period with under 1 cm ends the storm', () => {
  assert.equal(stormSnow(sensor({1: 2, 10: 0.5, 40: 6}), NOW).hst, 2); // hours 2-25 ago held only 0.5 cm
});
test('a dry last 24 h means no storm: HST 0', () => {
  assert.equal(stormSnow(sensor({30: 6, 35: 4}), NOW).hst, 0);
  assert.equal(stormSnow(sensor({}), NOW).hst, 0);
});
test('no data at all is null', () => {
  assert.equal(stormSnow([], NOW), null);
});
test('a storm running past the lookback is flagged partial', () => {
  const snow = {};
  for (let h = 0; h < 240; h += 12) snow[h] = 1;
  assert.equal(stormSnow(sensor(snow), NOW).partial, true);
});
test('missing hours are unknown, not dry', () => {
  const recs = sensor({2: 3, 40: 5}).filter(r => {
    const h = (NOW - Date.parse(r.measurementDateTime)) / HOUR;
    return h < 10 || h > 34; // a 24 h outage, which must not read as the dry break
  });
  const r = stormSnow(recs, NOW);
  assert.equal(r.hst, 8);
  assert.equal(r.partial, true);
});
test('HS-derived HN counts rises of 2 cm or more', () => {
  const recs = [];
  for (let h = 47; h >= 0; h--) recs.push({measurementDateTime: new Date(NOW - h * HOUR).toISOString(), snowHeight: 100 + (h < 12 ? (12 - h) : 0)});
  const r = stormSnow(recs, NOW);
  assert.ok(r.hst >= 10 && r.hst <= 12, `got ${r.hst}`);
});
