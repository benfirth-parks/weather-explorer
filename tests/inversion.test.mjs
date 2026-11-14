import test from 'node:test';
import assert from 'node:assert/strict';
import {detectInversion, hourlyTemps, inversionFromStations, inversionNoteMarkdown} from '../assets/inversion.js';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 14, 0); /* 18:00 MT Nov 13 */
const series = (band, temps) => ({elevation_band: band, hourly: Object.fromEntries(temps.map((v, i) => [T0 + i * H, v]))});

test('hourlyTemps averages readings within each hour', () => {
  const out = hourlyTemps([
    {measurementDateTime: new Date(T0).toISOString(), airTempAvg: -4},
    {measurementDateTime: new Date(T0 + 30 * 60000).toISOString(), airTempAvg: -6},
    {measurementDateTime: new Date(T0 + H).toISOString(), airTempAvg: null}
  ]);
  assert.deepEqual(out, {[T0]: -5});
});

test('no note with a normal lapse rate', () => {
  assert.equal(detectInversion([series('Alpine', [-10, -11, -12, -12]), series('Below treeline', [-3, -4, -5, -5])]), null);
  assert.equal(inversionNoteMarkdown(null), '');
});

test('alpine warmer than the valley overnight, cleared by the latest hour', () => {
  const inv = detectInversion([
    series('Alpine', [-8, -4, -3, -2, -8]),
    series('Alpine', [-8, -4, -3, -4, -8]),
    series('Below treeline', [-5, -8, -9, -10, -4])
  ]);
  assert.deepEqual(inv, {upper: 'Alpine', lower: 'Below treeline', hours: 3, hours_compared: 5, max_diff_c: 7, max_diff_hour_mt: 21, current: false, current_diff_c: -4});
  assert.equal(inversionNoteMarkdown(inv),
    '⚠ **Temperature inversion:** Alpine stations averaged warmer than Below treeline stations for **3 h** of the last 5, by up to **7 °C** (around 21:00 MT); no longer inverted at the latest hour.');
});

test('a short inversion still counts while it is on at the latest hour', () => {
  const inv = detectInversion([series('Treeline', [-6, -6, -2]), series('Below treeline', [-3, -4, -5])]);
  assert.equal(inv.hours, 1);
  assert.equal(inv.current, true);
  assert.match(inversionNoteMarkdown(inv), /^⚠ \*\*Temperature inversion:\*\* Treeline stations averaged warmer than Below treeline stations/);
  assert.match(inversionNoteMarkdown(inv), /and still are, by \*\*3 °C\*\* at the latest hour\.$/);
});

test('under 1 °C, or under 3 h and over, is not flagged', () => {
  assert.equal(detectInversion([series('Alpine', [-4.5, -4.5, -4.5, -4.5]), series('Treeline', [-5, -5, -5, -5])]), null);
  assert.equal(detectInversion([series('Alpine', [-2, -2, -9, -9]), series('Treeline', [-5, -5, -5, -5])]), null);
});

test('the note is not graded: the same heading whatever the difference', () => {
  const note = (alpine) => inversionNoteMarkdown(detectInversion([series('Alpine', [alpine, alpine, alpine]), series('Treeline', [-10, -10, -10])]));
  assert.match(note(-8), /^⚠ \*\*Temperature inversion:\*\* .*by up to \*\*2 °C\*\*/);
  assert.match(note(-1), /^⚠ \*\*Temperature inversion:\*\* .*by up to \*\*9 °C\*\*/);
});

test('only the newest 24 hours are compared, so the note never says "of the last 25"', () => {
  /* A 24 h window that starts mid-hour touches 25 clock hours. */
  const alpine = Array.from({length: 25}, () => -3);
  const valley = Array.from({length: 25}, () => -8);
  const inv = detectInversion([series('Alpine', alpine), series('Below treeline', valley)]);
  assert.equal(inv.hours, 24);
  assert.equal(inv.hours_compared, 24);
  assert.match(inversionNoteMarkdown(inv), /for \*\*24 h\*\* of the last 24,/);
});

test('inversionFromStations bands the stations by elevation and skips bad readings', () => {
  const obs = (temps) => temps.map((v, i) => ({measurementDateTime: new Date(T0 + i * H).toISOString(), airTempAvg: v}));
  const inv = inversionFromStations([
    {elevation: 2930, observations: obs([-4, -4, -4, -4])},
    {elevation: 2600, observations: obs([-6, -6, 999, -6])}, /* 999 is a sensor fault, not a reading */
    {elevation: 1450, observations: obs([-12, -12, -12, -12])},
    {elevation: undefined, observations: obs([30, 30, 30, 30])}, /* no elevation: left out */
    {elevation: 1310, observations: null}
  ]);
  assert.equal(inv.upper, 'Alpine');
  assert.equal(inv.lower, 'Below treeline');
  assert.equal(inv.hours, 4);
  assert.equal(inv.max_diff_c, 8); /* hour 3: alpine -4 alone against -12 */
  assert.equal(inversionFromStations([{elevation: 2930, observations: obs([-4, -4, -4])}]), null);
});

test('a region takes its groups together: fire stations are the valley stations', async () => {
  const {regionGroups} = await import('../netlify/functions/_ai-summary.mjs');
  assert.deepEqual(regionGroups([1]), [1, 2]);
  assert.deepEqual(regionGroups([2]), [1, 2]);
  assert.deepEqual(regionGroups([4]), [3, 4]);
  assert.deepEqual(regionGroups([5]), [5]);
  assert.deepEqual(regionGroups([1, 3]), [1, 2, 3, 4]);
  assert.deepEqual(regionGroups([]), [1, 2]);
  assert.deepEqual(regionGroups([99]), [1, 2]);
});

test('/api/inversion: group 1 alone still sees the valley stations of its region', async () => {
  const {inversionForGroups} = await import('../netlify/functions/inversion.mjs');
  const {STATION_META} = await import('../netlify/functions/_ai-summary.mjs');
  const elevation = Object.fromEntries(STATION_META.map(m => [m.stationId, m.elevation]));
  const now = Math.floor(Date.now() / H) * H;
  const asked = [];
  /* Cold pool: valley -14, treeline -9, alpine -6 for the last 12 h. One archive cannot be read. */
  const read = async (id) => {
    asked.push(id);
    if (id === 'fts-castle') throw new Error('blob store down');
    const temp = elevation[id] < 1800 ? -14 : elevation[id] < 2320 ? -9 : -6;
    return {observations: Array.from({length: 12}, (_, i) => ({measurementDateTime: new Date(now - (11 - i) * H).toISOString(), airTempAvg: temp}))};
  };
  const out = await inversionForGroups([1], read);
  assert.deepEqual(out.groups, [1, 2]);
  assert.equal(out.station_count, 17);
  assert.ok(asked.includes('fts-vermillion'));
  assert.ok(!asked.includes('fts-maligne'));
  assert.equal(out.inversion.upper, 'Alpine');
  assert.equal(out.inversion.lower, 'Below treeline');
  assert.equal('degree' in out.inversion, false);
  assert.equal(out.inversion.hours, 12);
  assert.match(out.note, /^⚠ \*\*Temperature inversion:\*\* Alpine stations averaged warmer than Below treeline stations for \*\*12 h\*\* of the last 12, by up to \*\*8 °C\*\*/);

  const none = await inversionForGroups([5], async () => ({observations: []}));
  assert.deepEqual(none.groups, [5]);
  assert.equal(none.inversion, null);
  assert.equal(none.note, '');
});
