import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR, hourlyRows, rowIndexAt, activeColumns, compass} from '../assets/hourly-table.js';

const NOW = Date.UTC(2026, 10, 18, 13); // 07:00 MT, on the hour
const rec = (hoursAgo, fields, minutes = 0) => ({measurementDateTime: new Date(NOW - hoursAgo * HOUR + minutes * 60000).toISOString(), ...fields});

test('one row per hour, newest first, with gaps kept', () => {
  const records = [rec(3, {airTempAvg: -8.2, snowHeight: 61}), rec(2, {airTempAvg: -8.9, snowHeight: 61.5}), rec(0, {airTempAvg: '-10.1', snowHeight: null})];
  const rows = hourlyRows(records, NOW - 4 * HOUR, NOW);
  assert.deepEqual(rows.map(r => r.hour), [0, 1, 2, 3].map(h => NOW - h * HOUR));
  assert.equal(rows[0].temp, -10.1);
  assert.equal(rows[0].hs, null);
  assert.equal(rows[1].t, null); // the hour with no report stays as a gap
  assert.equal(rows[3].hs, 61);
});

test('several readings in an hour: the last one is the row', () => {
  const rows = hourlyRows([rec(1, {airTempAvg: 1}, 15), rec(1, {airTempAvg: 2}, 45), rec(0, {airTempAvg: 3})], NOW - 2 * HOUR, NOW);
  assert.equal(rows[0].temp, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].t, null);
});

test('the hour in progress shows only once it has a reading', () => {
  const to = NOW + 20 * 60000;
  assert.equal(hourlyRows([rec(0, {airTempAvg: 3})], NOW - HOUR, to).length, 1);
  const rows = hourlyRows([rec(0, {airTempAvg: 3}), rec(0, {airTempAvg: 4}, 10)], NOW - HOUR, to);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].temp, 4);
});

test('HW per hour comes from the interval the reading falls in', () => {
  const hw = [{start: NOW - 2 * HOUR, end: NOW - HOUR, y: 0.4}, {start: NOW - HOUR, end: NOW, y: 1.2}];
  const rows = hourlyRows([rec(1, {precipTotal: 10}), rec(0, {precipTotal: 11.2})], NOW - 2 * HOUR, NOW, hw);
  assert.deepEqual(rows.map(r => r.hw), [1.2, 0.4]);
});

test('clicked time maps to the hour that contains it', () => {
  const rows = hourlyRows([rec(2, {airTempAvg: 1}), rec(1, {airTempAvg: 2}), rec(0, {airTempAvg: 3})], NOW - 3 * HOUR, NOW);
  assert.equal(rowIndexAt(rows, NOW - 90 * 60000), 1); // 05:30 is in the hour ending 06:00
  assert.equal(rowIndexAt(rows, NOW), 0);
  assert.equal(rowIndexAt(rows, NOW + 5 * HOUR), 0); // outside the range: nearest
  assert.equal(rowIndexAt([], NOW), -1);
});

test('columns: empty ones and hidden groups are dropped', () => {
  const rows = hourlyRows([rec(0, {airTempAvg: 1, windSpeedAvg: 12, windDirAvg: 270, snowHeight: 40})], NOW - HOUR, NOW);
  assert.deepEqual(activeColumns(rows).map(c => c.key), ['temp', 'wind', 'dir', 'hs']);
  assert.deepEqual(activeColumns(rows, {wind: false, hs: false}).map(c => c.key), ['temp']);
});

test('compass points', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(350), 'N');
  assert.equal(compass(225), 'SW');
  assert.equal(compass(-90), 'W');
  assert.equal(compass(null), null);
});
