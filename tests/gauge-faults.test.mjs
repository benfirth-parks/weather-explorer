import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanGaugeSpikes} from '../assets/gauge-spikes.js';
import {HOUR, gaugeOfflinePeriods, gaugeState, hwIntervals} from '../assets/pair-comparison-data.js';
import {newSnow24h} from '../assets/hst.js';
import {hw24FromObservations} from '../netlify/functions/_hw24.mjs';

const NOW = Date.UTC(2026, 10, 24, 1); // 19:00 MT 23 Nov 2026
const iso = ms => new Date(ms).toISOString();
/* 15-min readings for `hours` hours ending at NOW; pc(t) and hs(t) take ms before NOW. */
function quarter(pc, hs, hours = 48) {
  const out = [];
  for (let q = hours * 4; q >= 0; q--) {
    const ago = q * HOUR / 4;
    out.push({measurementDateTime: iso(NOW - ago), precipTotal: pc(ago), snowHeight: hs(ago)});
  }
  return out;
}

test('gauge spike: Bow Summit 23 Nov 12:15-12:45 MT rise and fall back is not HW', () => {
  // 12:15, 12:30, 12:45 MT are 6.75, 6.5 and 6.25 h before 19:00 MT.
  const blip = {[6.75 * HOUR]: 200.9, [6.5 * HOUR]: 205, [6.25 * HOUR]: 210.2};
  const recs = quarter(ago => blip[ago] ?? 200, () => 17);
  assert.equal(hw24FromObservations(recs.slice(-96)), 10.2, 'without the filter the blip reads as 10.2 mm');
  const clean = cleanGaugeSpikes(recs);
  assert.equal(hw24FromObservations(clean.slice(-96)), 0);
  assert.equal(hwIntervals(clean, NOW - 24 * HOUR, NOW, 1).total, 0);
  assert.equal(clean.filter(r => r.precipTotal !== 200).length, 0);
});

test('gauge spike: real precipitation and an emptying are kept', () => {
  // 3 mm over 6 h that stays in the bucket, then the gauge is emptied 1 h later (drops to 50 mm).
  const pc = ago => (ago > 10 * HOUR ? 400 : ago > 4 * HOUR ? 400 + (10 * HOUR - ago) / HOUR * 0.5 : ago > 3 * HOUR ? 403 : 50);
  const recs = quarter(pc, () => 30);
  const clean = cleanGaugeSpikes(recs);
  assert.deepEqual(clean.map(r => r.precipTotal), recs.map(r => r.precipTotal));
  assert.equal(hw24FromObservations(clean.slice(-96)), 3);
});

test('gauge spike: a rise that only falls back after more than 2 h is kept', () => {
  const pc = ago => (ago <= 10 * HOUR && ago > 7 * HOUR ? 205 : 200);
  const clean = cleanGaugeSpikes(quarter(pc, () => 30));
  assert.ok(clean.some(r => r.precipTotal === 205));
});

/* RDPS points [{x: hour end, y: mm}] for 10 days, `mm(agoH)` per hour. */
function rdps(mm, days = 10) {
  const out = [];
  for (let h = days * 24; h >= 0; h--) out.push({x: NOW - h * HOUR, y: mm(h)});
  return out;
}

test('gauge not reporting: flat for 3 days while RDPS forecast 5 mm or more', () => {
  const recs = quarter(() => 200, () => 17, 240);
  const fc = rdps(h => (h >= 100 && h < 110 ? 0.8 : 0)); // 8 mm about 4 days ago
  const periods = gaugeOfflinePeriods(recs, fc, NOW);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].end, null);
  assert.ok(periods[0].start <= NOW - 100 * HOUR);
  // A dry spell with a flat gauge is just dry.
  assert.deepEqual(gaugeOfflinePeriods(recs, rdps(() => 0.02), NOW), []);
});

test('gauge not reporting: ends when the gauge moves again', () => {
  const recs = quarter(ago => (ago > 20 * HOUR ? 200 : 201), () => 17, 240);
  const fc = rdps(h => (h >= 100 && h < 110 ? 0.8 : 0));
  const periods = gaugeOfflinePeriods(recs, fc, NOW);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].end, NOW - 20 * HOUR);
});

test('gauge not reporting: HN falls back to the RDPS check and says so', () => {
  // Depth rises 4 cm slowly 12 to 6 h ago; gauge flat for days.
  const hs = ago => (ago > 12 * HOUR ? 17 : ago > 6 * HOUR ? 17 + (12 * HOUR - ago) / HOUR * 4 / 6 : 21);
  const recs = quarter(() => 200, hs, 240);
  const wet = Object.assign(rdps(h => (h >= 100 && h < 110 ? 0.8 : h >= 6 && h < 12 ? 0.5 : 0)), {});
  wet.gaugeOffline = gaugeOfflinePeriods(recs, wet, NOW);
  assert.equal(gaugeState(recs, NOW, wet), 'offline');
  assert.ok(newSnow24h(recs, NOW, {gaugeCheck: true, forecast: wet}) >= 3, 'RDPS 3 mm confirms the rise');
  const dry = rdps(h => (h >= 100 && h < 110 ? 0.8 : 0));
  dry.gaugeOffline = gaugeOfflinePeriods(recs, dry, NOW);
  assert.equal(newSnow24h(recs, NOW, {gaugeCheck: true, forecast: dry}), 0, 'RDPS dry: the rise is not counted');
});

test('short depth dip: Sunshine 23 Nov, a 1 h dip does not lower the reference', () => {
  // Overnight 31 cm, a dip to 28 cm for about an hour around 06:00 MT (13 h ago), back to 31, then 32 by 17:00.
  const hs = ago => (ago > 13.5 * HOUR ? 31 : ago > 12.5 * HOUR ? 28 : ago > 2 * HOUR ? 31 : 32);
  const recs = quarter(ago => 270 + Math.max(0, 14 * HOUR - ago) / HOUR * 0.05, hs);
  assert.equal(newSnow24h(recs, NOW, {gaugeCheck: true}), 1);
});

test('settlement that lasts still lowers the reference', () => {
  // 40 cm settles to 36 over 8 h, then 3 cm of new snow 6 to 3 h ago with the gauge moving.
  const hs = ago => (ago > 20 * HOUR ? 40 : ago > 12 * HOUR ? 40 - (20 * HOUR - ago) / HOUR * 0.5 : ago > 6 * HOUR ? 36 : ago > 3 * HOUR ? 36 + (6 * HOUR - ago) / HOUR : 39);
  const pc = ago => (ago > 6 * HOUR ? 300 : ago > 3 * HOUR ? 300 + (6 * HOUR - ago) / HOUR * 0.5 : 301.5);
  assert.equal(newSnow24h(quarter(pc, hs), NOW, {gaugeCheck: true}), 3);
});
