import test from "node:test";
import assert from "node:assert/strict";
import { convertMeasurement, newestFtsTime, fetchBackup, AVCAN_SOURCE } from "../netlify/functions/_avcan.mjs";

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("convertMeasurement maps shared fields only", () => {
  const r = convertMeasurement({ measurementDateTime: "2026-11-01T06:00:00Z", snowHeight: 11.2, airTempAvg: -2.6,
    windDirGust: 200, hourlyPrecip: 3, newSnow: 2, relativeHumidity: 40 });
  assert.deepEqual(r, { measurementDateTime: "2026-11-01T06:00:00.000Z", source: AVCAN_SOURCE,
    snowHeight: 11.2, airTempAvg: -2.6, windDirPeak: 200, relativeHumidity: 40 });
  assert.equal(convertMeasurement({ measurementDateTime: "2026-11-01T06:00:00Z" }), null);
});

test("newestFtsTime skips backup records", () => {
  const obs = [{ measurementDateTime: iso(0) }, { measurementDateTime: iso(H), source: AVCAN_SOURCE }];
  assert.equal(newestFtsTime(obs), 0);
});

test("fetchBackup only runs when FTS360 is 3 h+ behind and returns hours after it", async () => {
  const now = Date.UTC(2026, 10, 1, 20);
  const lastFts = now - 13 * H;
  const measurements = [-14, -13, -12, -1].map((h) => ({ measurementDateTime: iso(now + h * H), snowHeight: 10 }));
  let called = 0;
  const fetchImpl = async (url) => { called++; assert.match(String(url), /stations\/110\/measurements/); return { ok: true, json: async () => ({ measurements }) }; };
  const out = await fetchBackup("fts-boslo", [{ measurementDateTime: iso(lastFts) }], { now, fetchImpl });
  assert.deepEqual(out.map((r) => r.measurementDateTime), [iso(now - 12 * H), iso(now - H)]);
  assert.equal(await fetchBackup("fts-boslo", [{ measurementDateTime: iso(now - H) }], { now, fetchImpl }).then((r) => r.length), 0);
  assert.equal(await fetchBackup("fts-skoki", [{ measurementDateTime: iso(lastFts) }], { now, fetchImpl }).then((r) => r.length), 0);
  assert.equal(called, 1);
  // The live API answers with a bare array, newest first.
  const arrayImpl = async () => ({ ok: true, json: async () => [...measurements].reverse() });
  const fromArray = await fetchBackup("fts-boslo", [{ measurementDateTime: iso(lastFts) }], { now, fetchImpl: arrayImpl });
  assert.deepEqual(fromArray.map((r) => r.measurementDateTime), [iso(now - 12 * H), iso(now - H)]);
});

test("archive merge: FTS360 replaces backup records, backup never overwrites FTS360", async () => {
  const { mergeAndPrune } = await import("../netlify/functions/_weather-archive.mjs");
  const t1 = new Date().toISOString();
  const t2 = new Date(Date.now() - H).toISOString();
  const existing = [
    { measurementDateTime: t2, snowHeight: 5, precipIncr: 1 },
    { measurementDateTime: t1, snowHeight: 9, relativeHumidity: 40, source: AVCAN_SOURCE }
  ];
  const fromBackup = mergeAndPrune(existing, [{ measurementDateTime: t2, snowHeight: 99, source: AVCAN_SOURCE }]);
  assert.deepEqual(fromBackup[0], { measurementDateTime: t2, snowHeight: 5, precipIncr: 1 });
  const fromFts = mergeAndPrune(existing, [{ measurementDateTime: t1, snowHeight: 8 }]);
  assert.deepEqual(fromFts[1], { measurementDateTime: t1, snowHeight: 8 });
});
