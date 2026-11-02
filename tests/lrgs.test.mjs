import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeMessage, goesTime, fetchNoaaRecords, NOAA_SOURCE } from "../netlify/functions/_lrgs.mjs";
import { mergeAndPrune } from "../netlify/functions/_weather-archive.mjs";
import { newestFtsTime, newestPrimaryTime, AVCAN_SOURCE } from "../netlify/functions/_avcan.mjs";

// Real GOES messages from NOAA LRGS, 2026-11-02.
const FIX = JSON.parse(readFileSync(new URL("./lrgs-fixture.json", import.meta.url), "utf8"));
const dec = (k) => decodeMessage(Buffer.from(FIX[k], "latin1"));
const strip = ({ source, ...r }) => r;

test("goesTime reads YYDDDHHMMSS as UTC", () => {
  assert.equal(new Date(goesTime("26306151024")).toISOString(), "2026-11-02T15:10:24.000Z");
});

test("line-per-value message matches the FTS360 record for the same hour", () => {
  const d = dec("fts-boslo");
  assert.equal(d.stationId, "fts-boslo");
  assert.deepEqual(d.records, [{ measurementDateTime: "2026-11-02T15:00:00.000Z", source: NOAA_SOURCE,
    airTempAvg: -3.8, relativeHumidity: 33, snowHeight: 10.9 }]);
  const m = dec("fts-maligne").records[0];
  assert.deepEqual(strip(m), { measurementDateTime: "2026-11-02T15:00:00.000Z", relativeHumidity: 87, airTempAvg: -12.3,
    windSpeedAvg: 0.2, windDirAvg: 262, windSpeedGust: 2.3, precipTotal: 587.9, snowHeight: 7.9 });
});

test("comma-separated message (Coleman) matches FTS360", () => {
  assert.deepEqual(strip(dec("fts-coleman").records[0]), { measurementDateTime: "2026-11-02T15:00:00.000Z",
    airTempAvg: -5.1, relativeHumidity: 56, windSpeedGust: 11.5, windDirPeak: 186, snowHeight: 3.3,
    windSpeedAvg: 3.6, windDirAvg: 187, airTempMax: -5.1, airTempMin: -5.4, precipTotal: 492.69 });
});

test("coded message (Sunshine) gives four 15-minute records, newest first in the message", () => {
  const recs = dec("fts-sunshine").records;
  const at = Object.fromEntries(recs.map((r) => [r.measurementDateTime, r]));
  assert.deepEqual(strip(at["2026-11-02T14:45:00.000Z"]), { measurementDateTime: "2026-11-02T14:45:00.000Z",
    precipTotal: 240.5, newSnow: 32, snowHeight: 19 });
  assert.equal(at["2026-11-02T14:15:00.000Z"].snowHeight, 18);
  assert.equal(at["2026-11-02T14:00:00.000Z"].airTempAvg, -5.9);
});

test("Summit Lake depth error (350.0, quality 0) is dropped, other fields kept", () => {
  const r = dec("summit350").records[0];
  assert.equal(r.snowHeight, undefined);
  assert.equal(typeof r.airTempAvg, "number");
  assert.equal(typeof dec("fts-summitlake").records[0].snowHeight, "number");
});

test("fetchNoaaRecords groups decoded records by station and skips when not configured", async () => {
  const fetchImpl = async ({ addresses, sinceHours }) => {
    assert.ok(addresses.includes("CBA5910C") && addresses.includes("4441041A"));
    assert.equal(sinceHours, 6);
    return { host: "x", messages: [Buffer.from(FIX["fts-boslo"], "latin1"), Buffer.from(FIX["fts-sunshine"], "latin1")] };
  };
  const out = await fetchNoaaRecords({ sinceHours: 6, env: { LRGS_USER: "u", LRGS_PASSWORD: "p" }, fetchImpl });
  assert.equal(out.byStation.get("fts-boslo").length, 1);
  assert.equal(out.byStation.get("fts-sunshine").length, 4);
  assert.equal((await fetchNoaaRecords({ env: {}, fetchImpl })).configured, false);
});

const T = "2026-11-02T15:00:00.000Z";
test("merge priority: NOAA, then FTS360, then Avalanche Canada", () => {
  const fts = { measurementDateTime: T, airTempAvg: -4, snowHeight: 11, precipIncr: 0.2 };
  const noaa = { measurementDateTime: T, source: NOAA_SOURCE, airTempAvg: -3.8, snowHeight: 10.9 };
  const av = { measurementDateTime: T, source: AVCAN_SOURCE, airTempAvg: -9, relativeHumidity: 10 };
  const want = { measurementDateTime: T, airTempAvg: -3.8, snowHeight: 10.9, precipIncr: 0.2, source: NOAA_SOURCE, ftsSeen: true };
  for (const order of [[fts, noaa, av], [noaa, fts, av], [av, fts, noaa], [av, noaa, fts], [noaa, av, fts]]) {
    assert.deepEqual(mergeAndPrune([], order), [want]);
  }
  assert.deepEqual(mergeAndPrune([av], [fts]), [fts]);           // FTS360 replaces backup outright
  assert.deepEqual(mergeAndPrune([fts], [av]), [fts]);           // backup never overrides
  assert.deepEqual(mergeAndPrune([av], [noaa]), [noaa]);         // NOAA replaces backup outright
});

test("FTS360 window follows FTS records; backup waits on NOAA or FTS360", () => {
  const obs = [
    { measurementDateTime: "2026-11-02T10:00:00.000Z" },
    { measurementDateTime: "2026-11-02T11:00:00.000Z", source: NOAA_SOURCE, ftsSeen: true },
    { measurementDateTime: "2026-11-02T12:00:00.000Z", source: NOAA_SOURCE },
    { measurementDateTime: "2026-11-02T13:00:00.000Z", source: AVCAN_SOURCE }
  ];
  assert.equal(new Date(newestFtsTime(obs)).toISOString(), "2026-11-02T11:00:00.000Z");
  assert.equal(new Date(newestPrimaryTime(obs)).toISOString(), "2026-11-02T12:00:00.000Z");
});
