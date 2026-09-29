import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR, numeric, ordered, metricSeries, precipitationSeries, matchedDifference} from '../assets/pair-comparison-data.js';
const record = (h, values) => ({measurementDateTime: new Date(h * HOUR).toISOString(), ...values});
test('missing values are not zero; timestamps are sorted and deduplicated', () => {
  assert.equal(numeric(null), null);
  assert.equal(numeric(''), null);
  assert.equal(numeric(0), 0);
  assert.deepEqual(ordered([record(2, {}), record(1, {}), record(2, {})]).map(r => r.x), [HOUR, 2 * HOUR]);
});
test('temperature and wind retain nulls and break long gaps', () => {
  const rows = [record(1, {airTempAvg: -2}), record(2, {airTempAvg: null}), record(5, {airTempAvg: 4})];
  const result = metricSeries(rows, 'temperature', 0, 6 * HOUR);
  assert.deepEqual(result.points.map(p => p.y), [-2, null, null, 4]);
  assert.equal(metricSeries([record(1, {windSpeedAvg: -3})], 'wind', 0, 2 * HOUR).points[0].y, null);
});
test('matched comparison is one-to-one and rejects distant timestamps', () => {
  assert.deepEqual(matchedDifference([{x: 0, y: 3}, {x: HOUR, y: 5}], [{x: 0, y: 1}, {x: HOUR, y: 3}]), {count: 2, difference: 2});
  assert.equal(matchedDifference([{x: 0, y: 3}], [{x: HOUR, y: 1}]).count, 0);
  assert.equal(matchedDifference([{x: 0, y: 3}, {x: 1, y: 5}], [{x: 0, y: 1}]).count, 1);
});
test('gauge resets and spikes are excluded, not counted as rain', () => {
  const rows = [100, 102, 0, 1, 100, 101].map((v, i) => record(i, {precipTotal: v}));
  const result = precipitationSeries(rows, 0, 6 * HOUR);
  assert.equal(result.total, 4);
  assert.equal(result.partial, true);
});
test('increment fallback works for pinned-zero total; valid dry weather remains zero', () => {
  const rows = [0, 1, 2].map((v, i) => record(i + 1, {precipTotal: 0, precipIncr: v}));
  assert.equal(precipitationSeries(rows, 0, 4 * HOUR).total, 3);
  assert.equal(precipitationSeries(rows.map(r => ({...r, precipIncr: 0})), 0, 4 * HOUR).total, 0);
  assert.equal(precipitationSeries([record(1, {})], 0, 4 * HOUR).total, null);
});
test('24h implausible precipitation is not plotted; long windows use their own totals', () => {
  const rows = [1, 2, 3, 4].map(h => record(h, {precipIncr: 50}));
  assert.equal(precipitationSeries(rows, 0, 24 * HOUR).total, null);
  assert.equal(precipitationSeries(rows, 0, 168 * HOUR).total, 200);
});
test('no accumulation spans missing hours or crosses the start boundary', () => {
  const rows = [record(0, {precipTotal: 10}), record(1, {precipTotal: 12}), record(5, {precipTotal: 20}), record(6, {precipTotal: 21})];
  const result = precipitationSeries(rows, 0.5 * HOUR, 7 * HOUR);
  assert.equal(result.total, 1);
  assert.equal(result.partial, true);
});
test('HS change is relative to the window start and rejects spikes', async () => {
  const {hsChangeSeries} = await import('../assets/pair-comparison-data.js');
  const rows = [100, 102, 180, 105, 103].map((v, i) => record(i, {snowHeight: v}));
  const result = hsChangeSeries(rows, 0, 6 * HOUR);
  assert.deepEqual(result.points.map(p => p.y), [0, 2, null, 5, 3]);
  assert.equal(result.total, 3);
  assert.equal(hsChangeSeries([record(1, {snowHeight: null})], 0, 2 * HOUR).total, null);
});
