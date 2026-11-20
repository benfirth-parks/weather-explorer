import test from 'node:test';
import assert from 'node:assert/strict';
import {stamp, aspectSummary, profileAt, summariseAwsome, AWSOME_POINTS} from '../assets/awsome-data.js';
import handler from '../netlify/functions/awsome.mjs';

const feature = (location, pu, depth, grain) => ({properties: {location, snowpack: {hs: 24.95, Punstable: {value: pu, depth, grainType: grain, instabilityDrivenBy: 'shallow_old_snow'}}, weather: {hn24: 2.1, ta: -9.3, dw24_sector: 'SE'}}});
const files = {
  F: {features: [feature('B_0006_0022', 0.67, 22.87, 'DH')]},
  N: {features: [feature('B_0006_0022', 0.61, 8.79, 'SH')]},
  E: {features: [feature('B_0006_0022', 0.61, 8.77, 'SH')]},
  S: {features: [feature('B_0006_0022', 0.37, 4.34, 'DF')]},
  W: {features: [feature('other', 0.9, 1, 'PP')]}
};
const T = Date.UTC(2026, 10, 19, 6) / 1000;
const xs = {time: [T - 10800, T, T + 10800], hs: [20, 25, 26],
  tops: [[10, 20], [8, 16.7, 25], [1]],
  params: {grainshape: [['DH', 'DF'], ['DH', 'SH', 'PP'], ['DH']], punstable: [[0.1, null], [0.66, 0.61, null], [0.2]], layer_of_interest: [[1, 0], [1, 1, 0], [0]], hardness: [[1, 1], [1, 1.27], [1]], temperature: [[-1, -2], [-0.5, -3], [-1]]}};

test('model time maps to the snapshot file stamp', () => {
  assert.equal(stamp('2026-11-19T06:00:00'), '2026-11-19_06-00-00');
  assert.equal(stamp('nope'), null);
});
test('aspect summary finds the location and ignores others', () => {
  assert.deepEqual(aspectSummary(files.N, 'B_0006_0022'), {pu: 0.61, depth: 8.79, grain: 'SH', tag: 'shallow_old_snow'});
  assert.equal(aspectSummary(files.W, 'B_0006_0022'), null);
});
test('profile is taken at the model time, layers bottom up with bottoms filled in', () => {
  const p = profileAt(xs, T);
  assert.equal(p.t, T * 1000);
  assert.deepEqual(p.layers, [[8, 0, 'DH', 0.66, 1, 1, -0.5], [16.7, 8, 'SH', 0.61, 1, 1.27, -3], [25, 16.7, 'PP', null, 0, null, null]]);
  assert.equal(profileAt(xs, T - 99999), null);
});
test('summary carries weather, aspects and profile', () => {
  const s = summariseAwsome('goats_eye', '2026-11-19T06:00:00', files, xs);
  assert.equal(s.location, AWSOME_POINTS.goats_eye.location);
  assert.equal(s.weather.hn24, 2.1);
  assert.equal(s.aspects.W, null);
  assert.equal(s.profile.layers.length, 3);
});
test('handler reads the current model time and returns the snapshot', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    seen.push(String(url));
    const u = String(url);
    let body;
    if (u.endsWith('dcfg/operational.json')) body = {date: '2026-11-19T06:00:00'};
    else if (u.includes('/nivix/xs')) body = xs;
    else body = files[/\.([FNESW])\.json$/.exec(u)[1]];
    return new Response(JSON.stringify(body), {status: 200});
  };
  try {
    const res = await handler(new Request('https://x/api/awsome?plot=goats_eye'));
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.aspects.N.grain, 'SH');
    assert.ok(seen.some(u => u.includes('banff_grid/geojson/2026-11-19_06-00-00.F.json')));
    const bad = await handler(new Request('https://x/api/awsome?plot=nowhere'));
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = real; }
});
