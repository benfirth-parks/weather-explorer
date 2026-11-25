import test from "node:test";
import assert from "node:assert/strict";
import { decodeMessage, decodeBody, LRGS_STATIONS } from "../netlify/functions/_lrgs.mjs";
import { kcRadiation, radiationOnly } from "../netlify/functions/kc-radiation.mjs";

/* Mock GOES messages shaped like Ben's handoff (25 Nov 2026); no real message text is stored here. */
function message(addr, sentIso, body) {
  const d = new Date(sentIso);
  const doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const t = `${p(d.getUTCFullYear() % 100)}${p(doy, 3)}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return Buffer.from((addr + t + "G").padEnd(32, "0") + String(body.length).padStart(5, "0") + body, "latin1");
}
const row = (type, hhmmss, vals) => `${type} ${hhmmss} ${vals.join(",")}`;
const bRow = (hhmmss, a, b) => row(1, hhmmss, [1, -6.2, 80, 3.1, 250, 4.0, 31.9, 0.1, 12.5, a, b, 13.1]);
const rRow = (hhmmss, sw) => row(0, hhmmss, [9001, -2.3, 70, 7.9, 260, 12.1, 0.6, -2.0, -2.5, 0, sw, 13.0]);

test("K-Country stations are in the LRGS list with their DCP addresses", () => {
  assert.equal(LRGS_STATIONS["kc-burstall"].addr, "C4000254");
  assert.equal(LRGS_STATIONS["kc-rundle"].addr, "ABC03668");
});

test("Burstall: hourly mean of the 15-minute '1' rows, positions 9 and 10", () => {
  const body = "\r\n" + [bRow("19:15:00", 150, 180), bRow("19:30:00", 160, 190), bRow("19:45:00", 165, 195), bRow("20:00:00", 155, 185), row(0, "20:00:00", [7, 7, 7])].join("\r\n") + "\r\n";
  const d = decodeMessage(message("C4000254", "2026-11-24T20:02:10Z", body));
  assert.equal(d.stationId, "kc-burstall");
  assert.deepEqual(d.records, [{ measurementDateTime: "2026-11-24T20:00:00.000Z", source: "noaa", swA: 157.5, swB: 187.5 }]);
});

test("Burstall night reads ~0; Rundle '0' row position 10 is incoming shortwave", () => {
  const night = decodeBody("kc-burstall", [bRow("06:15:00", 0.2, -0.4), bRow("06:30:00", 0.1, -0.3), bRow("06:45:00", 0, -0.5), bRow("07:00:00", 0.3, -0.2)].join("\n"), Date.parse("2026-11-25T07:01:00Z"));
  assert.ok(Math.abs(night[0].swA) < 1 && Math.abs(night[0].swB) < 1);
  const d = decodeMessage(message("ABC03668", "2026-11-24T20:00:40Z", "\r\n" + rRow("20:00:00", 261.4) + "\r\n"));
  assert.equal(d.stationId, "kc-rundle");
  assert.equal(d.records[0].swIn, 261.4);
});

test("a row from before midnight in a message sent just after it goes on the previous day", () => {
  assert.equal(decodeBody("kc-rundle", rRow("23:00:00", 0), Date.parse("2026-11-25T00:01:00Z"))[0].measurementDateTime, "2026-11-24T23:00:00.000Z");
});

test("relay returns only shortwave fields, nothing else", () => {
  assert.deepEqual(radiationOnly([{ measurementDateTime: "t1", swA: 1, swB: 2, source: "noaa", airTempAvg: -3 }, { measurementDateTime: "t2", source: "noaa" }]),
    [{ measurementDateTime: "t1", swA: 1, swB: 2 }]);
});

test("relay reads both stations, reports whether the login is set, never returns it", async () => {
  const now = Date.now(), iso = (h) => new Date(now - h * 3600000).toISOString();
  const archives = { "kc-burstall": { observations: [{ measurementDateTime: iso(1), swA: 150, swB: 180 }] }, "kc-rundle": { observations: [{ measurementDateTime: iso(1), swIn: 250 }, { measurementDateTime: iso(100), swIn: 9 }] } };
  const r = await kcRadiation(48, async (id) => archives[id], { LRGS_USER: "u", LRGS_PASSWORD: "p" });
  assert.equal(r.configured, true);
  assert.equal(r.stations["kc-burstall"][0].swB, 180);
  assert.equal(r.stations["kc-rundle"].length, 1);
  assert.ok(!JSON.stringify(r).includes('"p"') && !JSON.stringify(r).includes("LRGS"));
  assert.equal((await kcRadiation(48, async (id) => archives[id], {})).configured, false);
});
