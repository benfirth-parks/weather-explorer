import test from 'node:test';
import assert from 'node:assert/strict';
import {utcTime, currentSeason, summarisePlot, simTemps, hardnessLabel, pitIsCurrent, plotForPairIds, decodeByk, summariseByk} from './plot-profile-fixture.mjs';
import handler from '../netlify/functions/plot-profile.mjs';
import {SITES, SEASON} from './plot-profile-fixture.mjs';

test('source times are UTC, with or without minutes', () => {
  assert.equal(utcTime('2026-10-07T12'), Date.UTC(2026, 9, 7, 12));
  assert.equal(utcTime('2026-10-07T12:30'), Date.UTC(2026, 9, 7, 12, 30));
  assert.equal(utcTime('nope'), null);
  assert.equal(utcTime(null), null);
});
test('the live season is chosen, otherwise the newest', () => {
  assert.equal(currentSeason(SITES, 'bow_summit').season.season, '2026-2027');
  const noLive = {sites: [{id: 'simpson', seasons: [{season: '2024-2025', file: 'a'}, {season: '2025-2026', file: 'b'}]}]};
  assert.equal(currentSeason(noLive, 'simpson').season.file, 'b');
  assert.equal(currentSeason(SITES, 'nowhere'), null);
});
test('the latest simulated profile and latest pit are kept, by time not array order', () => {
  const s = summarisePlot('bow_summit', SITES.sites[0], SEASON);
  assert.equal(s.sim.t, Date.UTC(2026, 9, 7, 12));
  assert.equal(s.sim.layers.length, 4);
  assert.equal(s.pit.id, 'pit-2');
  assert.equal(s.pit.layers[0].length, 5);
  assert.deepEqual(s.pit.score, {hsDiff: -4, grainAgreement: 0.62, hardnessMae: 0.8});
  assert.equal(s.elevation, 2040);
  assert.match(s.url, /site=bow_summit$/);
});
test('an empty season gives no profiles rather than an error', () => {
  const s = summarisePlot('simpson', null, {season: '2026-2027', nowcast: [], pits: []});
  assert.equal(s.sim, null);
  assert.equal(s.pit, null);
  assert.equal(s.name, 'Simpson');
});
test('simulated temperatures sit at layer mid-heights', () => {
  assert.deepEqual(simTemps([[40, 30, 'PP', 1, 90, -6, 0, 0], [30, 0, 'FC', 2, 250, -2, 0, 2]]), [[35, -6], [15, -2]]);
});
test('hand hardness labels, including in-between values', () => {
  assert.equal(hardnessLabel(1), 'F');
  assert.equal(hardnessLabel(2.5), '4F-1F');
  assert.equal(hardnessLabel(3.9), 'P');
  assert.equal(hardnessLabel(null), '–');
});
test('a pit is drawn only while it is under two weeks old', () => {
  const now = Date.UTC(2026, 9, 9);
  assert.equal(pitIsCurrent({t: Date.UTC(2026, 9, 1)}, now), true);
  assert.equal(pitIsCurrent({t: Date.UTC(2026, 8, 20)}, now), false);
  assert.equal(pitIsCurrent(null, now), false);
});
test('only pairs at a study plot get a profile', () => {
  assert.equal(plotForPairIds(['fts-vulture', 'fts-bowsummit']), 'bow_summit');
  assert.equal(plotForPairIds(['fts-lookout', 'fts-sunshine']), 'goats_eye');
  assert.equal(plotForPairIds(['fts-bosup', 'fts-boslo']), 'bosworth_lower');
  assert.equal(plotForPairIds(['fts-whymper', 'fts-stanley']), null);
});

test('the function returns the compact record and rejects unknown plots', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async url => {
    seen.push(String(url));
    const body = String(url).endsWith('sites.json') ? SITES : SEASON;
    return new Response(JSON.stringify(body), {status: 200});
  };
  try {
    const bad = await handler(new Request('https://x/api/plot-profile?plot=../etc'));
    assert.equal(bad.status, 400);
    const res = await handler(new Request('https://x/api/plot-profile?plot=bow_summit'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pit.id, 'pit-2');
    assert.deepEqual(seen, ['https://banff-snowpack.netlify.app/data/sites.json', 'https://banff-snowpack.netlify.app/data/bow_summit/2026-2027.json']);
    assert.match(res.headers.get('cache-control'), /max-age=600/);
    // A second read within the memory window does not refetch.
    await handler(new Request('https://x/api/plot-profile?plot=bow_summit'));
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test('the function reports the source being down', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', {status: 503});
  try {
    const res = await handler(new Request('https://x/api/plot-profile?plot=goats_eye'));
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* BYK /api/point layout (banff-snowpack-model netlify/lib/pipeline.mjs): flat field is aspect 0. 80 cm deep:
   new snow 0-12 cm (PP, F), a crust 12-15 cm (MFcr, K), facets 15-80 cm (FC, 4F) rated a weak layer at 40 cm. */
const BYK_DAY = t => ({t, date: '2026-11-01', hs: [80, 70, 75, 60, 72],
  A: [[0, 0, 10, -80, 3, 90, 120, 8, 50, -40, 10, 400, 150, 4, 20, -20, 15, 260], [], [], [], []],
  W: [[[40, 4, 492000, 72, 5], [5, 0, 492100, 20, 1]], [], [], [], []]});
test('a BYK flat-field profile becomes heights above ground with grain codes and weak-layer outlines', () => {
  const rows = decodeByk(BYK_DAY(493000));
  assert.deepEqual(rows, [
    [80, 68, 'PP', 1, 90, -8, null, 0],
    [68, 65, 'MFcr', 5, 400, -4, null, 1],
    [65, 0, 'FC', 2, 260, -2, null, 2]
  ]);
  assert.deepEqual(decodeByk({}), []);
});
test('the BYK record uses the newest analysed state and has no pit', () => {
  const s = summariseByk('bosworth_lower', {id: 'fts-boslo', season: '2026-27', days: [BYK_DAY(492990), BYK_DAY(492966)], forecast: {now: BYK_DAY(493000)}});
  assert.equal(s.source, 'byk');
  assert.equal(s.sim.t, 493000 * 3600000);
  assert.equal(s.sim.hs, 80);
  assert.equal(s.pit, null);
  assert.equal(s.elevation, 2210);
  assert.match(s.url, /point=fts-boslo$/);
  const noNow = summariseByk('bosworth_lower', {days: [BYK_DAY(492966), BYK_DAY(492990)], forecast: null});
  assert.equal(noNow.sim.t, 492990 * 3600000);
  assert.equal(summariseByk('bosworth_lower', {days: []}).sim, null);
});
test('the function reads Bosworth Lower from the BYK model', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async url => {
    seen.push(String(url));
    return new Response(JSON.stringify({id: 'fts-boslo', season: '2026-27', days: [BYK_DAY(493000)], forecast: null}), {status: 200});
  };
  try {
    const res = await handler(new Request('https://x/api/plot-profile?plot=bosworth_lower'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sim.layers.length, 3);
    assert.deepEqual(seen, ['https://banff-snowpack-model.netlify.app/api/point?id=fts-boslo']);
  } finally {
    globalThis.fetch = realFetch;
  }
});
