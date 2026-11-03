import test from 'node:test';
import assert from 'node:assert/strict';
import {stormSnow, stormPeriod, hsMedianAt, newSnow24h, hourlyHn} from '../assets/hst.js';
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

test('HST is the HS rise since the storm began', () => {
  // Snow 30 to 2 hours ago with no gap over 24 h; HS 40 cm before, 46 by 25 h ago, 49 by 12 h ago, 52 now.
  const r = stormSnow(station({30: 2, 25: 1, 12: 3, 2: 1}, h => (h > 30 ? 40 : h > 25 ? 43 : h > 12 ? 46 : h > 2 ? 49 : 52)), NOW);
  assert.equal(r.hst, 12);
  assert.equal(r.start, NOW - 31 * HOUR);
  assert.equal(r.partial, false);
});
test('a gap of more than 24 h with no new snow starts a new storm', () => {
  // Snow 60 h ago, then nothing for 40 h, then snow again: only the second storm counts.
  const r = stormSnow(station({60: 5, 20: 2, 5: 2}, h => (h > 60 ? 30 : h > 20 ? 38 : 43)), NOW);
  assert.equal(r.hst, 5);
  assert.equal(r.start, NOW - 21 * HOUR);
});
test('a gap of exactly 24 h keeps the storm going', () => {
  assert.equal(stormPeriod(station({}, h => (h > 30 ? 10 : h > 5 ? 13 : 16)), NOW).start, NOW - 31 * HOUR);
});
test('rain with no depth rise is not a storm', () => {
  assert.equal(stormSnow(station({5: 3}, () => 20), NOW).hst, 0);
});
test('no new snow in the last 24 h: HST 0', () => {
  const r = stormSnow(station({40: 5}, h => (h > 40 ? 20 : 26)), NOW);
  assert.equal(r.hst, 0);
  assert.equal(r.start, null);
});
test('settlement after the peak does not reduce HST', () => {
  // Storm of 10 cm 20 to 15 h ago with rain, then 4 cm of settlement.
  const hs = h => (h > 20 ? 50 : h > 15 ? 50 + (20 - h) * 2 : h > 12 ? 60 : 60 - (12 - h) / 3);
  const recs = station({20: 1, 18: 1, 16: 1}, hs);
  assert.equal(newSnow24h(recs, NOW), 10);
  assert.equal(stormSnow(recs, NOW).hst, 10); // peak 60 - 50, not the 6 cm left after settling
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
test('HST is the HS change, so settlement during the storm counts against it', () => {
  // Rain 30 to 10 h ago; HS 40 -> 50 by 20 h ago, settles to 47, then 52 after a 5 cm burst.
  const hs = h => (h > 30 ? 40 : h > 20 ? 50 : h > 12 ? 47 : 52);
  const r = stormSnow(station({30: 2, 20: 1, 12: 3}, hs), NOW);
  assert.equal(r.hst, 12); // 52 - 40, where summing the hourly HN would give 15
});
test('HN24 sums the hourly HN over the last 24 h and ignores the new-snow field', () => {
  const recs = station({30: 2, 10: 2}, h => (h > 30 ? 40 : h > 10 ? 46 : 50)).map(r => ({...r, newSnow: 0.1}));
  assert.equal(newSnow24h(recs, NOW), 4);
  assert.equal(hourlyHn(recs, NOW - 24 * HOUR, NOW).points.length, 24);
  assert.equal(newSnow24h([], NOW), null);
});
test('a depth that falls below the storm start keeps the peak rise', () => {
  // 6 cm of new snow 10 h ago, then the whole pack settles 8 cm.
  const r = stormSnow(station({}, h => (h > 10 ? 80 : h > 8 ? 86 : 86 - (8 - h))), NOW);
  assert.equal(r.hst, 6);
});

/* Gauge check (Sunshine, Ben 3 Nov 2026). 15-min readings; `jitter` adds the sensor's +/-2 cm wander. */
import {gaugeState} from '../assets/pair-comparison-data.js';
import {readFileSync} from 'node:fs';
function quarterHourly(hs, gauge, hours = 72) {
  const out = [], wobble = [0, -1, 1, -2, 2, 0, -1, 1];
  for (let q = hours * 4 - 1; q >= 0; q--) {
    const h = q / 4;
    out.push({measurementDateTime: new Date(NOW - q * HOUR / 4).toISOString(), snowHeight: hs(h) + wobble[q % 8], precipTotal: gauge(h)});
  }
  return out;
}
test('gauge check: Sunshine depth jitter with a flat gauge is not new snow (Nov 2-3 2026 data)', () => {
  // Real Sunshine readings, 07:00 MT Oct 31 to Nov 3: gauge flat at 240.5 mm, depth wandering 18 to 22 cm.
  const recs = JSON.parse(readFileSync(new URL('./sunshine-dry-fixture.json', import.meta.url)));
  const now = Date.parse('2026-11-03T13:00:00Z');
  assert.equal(newSnow24h(recs, now), 4, 'the plain depth rule counts the jitter');
  assert.equal(newSnow24h(recs, now, {gaugeCheck: true}), 0);
  assert.equal(stormSnow(recs, now, {gaugeCheck: true}).hst, 0);
  assert.equal(gaugeState(recs, now), 'ok');
});
test('gauge check: a depth rise the gauge confirms is counted', () => {
  // 8 cm of snow 12 to 6 h ago, 6 mm on the gauge over the same hours.
  const hs = h => (h > 12 ? 20 : h > 6 ? 20 + (12 - h) * 8 / 6 : 28);
  const gauge = h => (h > 12 ? 240 : h > 6 ? 240 + (12 - h) : 246);
  const hn = newSnow24h(quarterHourly(hs, gauge), NOW, {gaugeCheck: true});
  assert.ok(hn >= 6 && hn <= 10, `HN24 ${hn}`);
});
test('gauge check: a stuck gauge falls back to depth only and says so', () => {
  const hs = h => (h > 12 ? 20 : h > 6 ? 20 + (12 - h) * 8 / 6 : 28);
  const recs = quarterHourly(hs, () => 200);
  const hn = newSnow24h(recs, NOW, {gaugeCheck: true});
  assert.ok(hn >= 5 && hn <= 10, `HN24 ${hn}`);
  assert.equal(gaugeState(recs, NOW), 'stuck');
});
test('gauge check: no gauge data falls back to depth only', () => {
  const hs = h => (h > 12 ? 20 : h > 6 ? 20 + (12 - h) * 8 / 6 : 28);
  const recs = quarterHourly(hs, () => null);
  assert.ok(newSnow24h(recs, NOW, {gaugeCheck: true}) >= 5);
  assert.equal(gaugeState(recs, NOW), 'missing');
});
