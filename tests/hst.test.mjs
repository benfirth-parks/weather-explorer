import test from 'node:test';
import assert from 'node:assert/strict';
import {stormSnow, stormPeriod, hsMedianAt} from '../assets/hst.js';
import {HOUR} from '../assets/pair-comparison-data.js';

const NOW = Date.UTC(2026, 0, 20, 7); // MST midnight, on an hour boundary
/* Hourly gauge and depth: `rain` maps hours-ago -> mm in that hour, `hs(h)` gives HS h hours ago. */
function station(rain, hs, hours = 240) {
  const out = [];
  let total = 100;
  for (let h = hours - 1; h >= 0; h--) {
    total += rain[h] ?? 0;
    out.push({measurementDateTime: new Date(NOW - h * HOUR).toISOString(), precipTotal: Math.round(total * 10) / 10, snowHeight: hs(h)});
  }
  return out;
}

test('HST is the HS change since the storm began', () => {
  // Precipitation 30 to 2 hours ago with a 10 h pause; HS 40 cm before, 52 cm now.
  const r = stormSnow(station({30: 2, 25: 1, 12: 3, 2: 1}, h => (h > 30 ? 40 : h > 2 ? 46 : 52)), NOW);
  assert.equal(r.hst, 12);
  assert.equal(r.start, NOW - 31 * HOUR);
  assert.equal(r.partial, false);
});
test('a gap of more than 24 h with no precipitation starts a new storm', () => {
  // Rain 60 h ago, then nothing for 40 h, then rain again: only the second storm counts.
  const r = stormSnow(station({60: 5, 20: 2, 5: 2}, h => (h > 60 ? 30 : h > 20 ? 38 : 43)), NOW);
  assert.equal(r.hst, 5);
  assert.equal(r.start, NOW - 21 * HOUR);
});
test('a gap of exactly 24 h keeps the storm going', () => {
  assert.equal(stormPeriod(station({30: 1, 5: 1}, () => 10), NOW).start, NOW - 31 * HOUR);
});
test('no precipitation in the last 24 h: HST 0', () => {
  const r = stormSnow(station({40: 5}, h => (h > 40 ? 20 : 26)), NOW);
  assert.equal(r.hst, 0);
  assert.equal(r.start, null);
});
test('HST is never below the HN24 passed in', () => {
  const r = stormSnow(station({40: 5}, () => 20), NOW, {hn24: 1.7});
  assert.equal(r.hst, 1.7);
  assert.equal(r.start, NOW - 24 * HOUR);
  assert.equal(stormSnow(station({30: 2, 12: 1, 2: 1}, h => (h > 30 ? 40 : 52)), NOW, {hn24: 4}).hst, 12); // already higher
});
test('settling during the storm never makes HST negative', () => {
  assert.equal(stormSnow(station({10: 1}, h => (h > 10 ? 50 : 47)), NOW).hst, 0);
});
test('no gauge: HS rises of 2 cm or more time the storm', () => {
  const recs = [];
  for (let h = 47; h >= 0; h--) recs.push({measurementDateTime: new Date(NOW - h * HOUR).toISOString(), snowHeight: 100 + (h < 12 ? (12 - h) : 0)});
  const r = stormSnow(recs, NOW);
  assert.ok(r.hst >= 10 && r.hst <= 12, `got ${r.hst}`);
});
test('no depth data is null', () => {
  assert.equal(stormSnow([], NOW), null);
  assert.equal(stormSnow(station({2: 1}, () => null), NOW), null);
});
test('a storm running past the lookback is flagged partial', () => {
  const rain = {};
  for (let h = 0; h < 240; h += 12) rain[h] = 1;
  assert.equal(stormSnow(station(rain, h => 300 - h), NOW).partial, true);
});
test('HS at a time is the median of readings within 90 min, none after now', () => {
  const hs = [0, 1, 2, 3].map(h => ({x: NOW - h * HOUR, y: [9, 2, 8, 5][h]}));
  assert.equal(hsMedianAt(hs, NOW, NOW), 5.5); // readings 0 and 1 h ago
  assert.equal(hsMedianAt(hs, NOW - 2 * HOUR, NOW), 5); // 1, 2 and 3 h ago: 2, 8, 5
  assert.equal(hsMedianAt(hs, NOW - 10 * HOUR, NOW), null);
});
