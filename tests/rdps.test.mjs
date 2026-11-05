import test from 'node:test';
import assert from 'node:assert/strict';
import {rdpsPoints, rdpsUrl, fetchRdps} from '../netlify/functions/_rdps.mjs';

test('RDPS: Open-Meteo hourly JSON becomes hour-end points in UTC', () => {
  const pts = rdpsPoints({hourly: {time: ['2026-11-03T12:00', '2026-11-03T13:00', '2026-11-03T14:00'], precipitation: [0, 0.4, null]}});
  assert.deepEqual(pts, [{x: Date.UTC(2026, 10, 3, 12), y: 0}, {x: Date.UTC(2026, 10, 3, 13), y: 0.4}]);
  assert.match(rdpsUrl('fts-sunshine'), /models=gem_regional/);
  assert.equal(rdpsUrl('fts-bosup'), null);
});
test('RDPS: a failed fetch gives null, so HN runs without the back check', async () => {
  const pts = await fetchRdps('fts-sunshine', {fetchImpl: async () => ({ok: false, status: 503})});
  assert.equal(pts, null);
});
test('RDPS: every HN-checked station has an RDPS point', async () => {
  const {HN_GAUGE_CHECK_IDS, HN_NO_GAUGE_IDS} = await import('../assets/pair-comparison-data.js');
  const {RDPS_POINTS} = await import('../netlify/functions/_rdps.mjs');
  for (const id of HN_GAUGE_CHECK_IDS) assert.ok(RDPS_POINTS[id], `${id} has no RDPS point`);
  for (const id of HN_NO_GAUGE_IDS) assert.ok(HN_GAUGE_CHECK_IDS.has(id), `${id} is not HN-checked`);
});
