import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, diffIncidents, stationTimes, alertEmail, recoveryEmail, formatMt } from "../netlify/functions/_site-health.mjs";

const H = 3600 * 1000;
const NOW = Date.parse("2026-11-02T18:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

function archive({ synced = 0.5, noaa = 1, fts = 2, backup = null }) {
  const obs = [];
  if (fts != null) obs.push({ measurementDateTime: iso(NOW - fts * H) });
  if (noaa != null) obs.push({ measurementDateTime: iso(NOW - noaa * H), source: "noaa" });
  if (backup != null) obs.push({ measurementDateTime: iso(NOW - backup * H), source: "avalanche-canada" });
  obs.sort((a, b) => Date.parse(a.measurementDateTime) - Date.parse(b.measurementDateTime));
  return { lastSyncedAt: iso(NOW - synced * H), observations: obs };
}
const keys = (a) => evaluate([stationTimes(a)], NOW).map((p) => p.key).sort();

test("healthy site has no problems", () => {
  assert.deepEqual(keys(archive({})), []);
});

test("NOAA down while FTS360 current", () => {
  assert.deepEqual(keys(archive({ noaa: 5, fts: 1 })), ["noaa-down"]);
});

test("FTS360 down while NOAA current", () => {
  assert.deepEqual(keys(archive({ noaa: 1, fts: 8 })), ["fts-down"]);
  assert.deepEqual(keys(archive({ noaa: 1, fts: 5 })), []);
});

test("both primary feeds down, backup filling", () => {
  assert.deepEqual(keys(archive({ noaa: 10, fts: 10, backup: 1 })), ["on-backup"]);
});

test("no fresh data from any feed", () => {
  assert.deepEqual(keys(archive({ noaa: 10, fts: 10, backup: 9 })), ["data-stale"]);
});

test("sync stopped", () => {
  assert.deepEqual(keys(archive({ synced: 4 })), ["sync-stopped"]);
});

test("newest across stations counts", () => {
  const t = [stationTimes(archive({ noaa: 10, fts: 10 })), stationTimes(archive({}))];
  assert.deepEqual(evaluate(t, NOW), []);
});

test("incidents open once and close once", () => {
  const p = [{ key: "noaa-down", title: "t", detail: "d" }];
  const a = diffIncidents({}, p, NOW);
  assert.deepEqual(a.opened.map((i) => i.key), ["noaa-down"]);
  const b = diffIncidents(a.next, p, NOW + H);
  assert.equal(b.opened.length, 0);
  assert.equal(b.next["noaa-down"].openedAt, iso(NOW));
  const c = diffIncidents(b.next, [], NOW + 2 * H);
  assert.deepEqual(c.closed.map((i) => i.key), ["noaa-down"]);
  assert.deepEqual(c.next, {});
});

test("emails and MT time", () => {
  assert.equal(formatMt(NOW), "2026-11-02 12:00 MT");
  const inc = { key: "x", title: "Feed down", detail: "d", openedAt: iso(NOW), closedAt: iso(NOW + 3 * H) };
  assert.match(alertEmail(inc).subject, /Problem: Feed down/);
  assert.match(recoveryEmail(inc).text, /3 h/);
});
