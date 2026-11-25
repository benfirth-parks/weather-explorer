import test from "node:test";
import assert from "node:assert/strict";
import { hasRadiation, radiationSeries, radiationChartConfig } from "../assets/radiation.js";

const rec = (iso, swIn, swOut, lwIn, lwOut) => ({ measurementDateTime: iso, swIn, swOut, lwIn, lwOut });

test("net shortwave, longwave and net radiation per hour", () => {
  const recs = [rec("2026-11-23T19:00:00Z", 302.3, 274.2, 260.4, 270.6), rec("2026-11-24T06:00:00Z", -0.7, 0.3, 267.1, 266)];
  const r = radiationSeries(recs, Date.parse("2026-11-23T00:00:00Z"), Date.parse("2026-11-25T00:00:00Z"));
  assert.deepEqual(r.sw.map((p) => p.y), [28.1, 0]);   // night offset is not negative sunlight
  assert.deepEqual(r.lw.map((p) => p.y), [-10.2, 1.1]);
  assert.deepEqual(r.net.map((p) => p.y), [17.9, 1.1]);
  assert.equal(r.meanNet, 9.5);
});

test("hours missing a component are left out", () => {
  const recs = [rec("2026-11-23T19:00:00Z", 300, 200, null, 270), rec("2026-11-23T20:00:00Z", 300, 200, 250, 270)];
  assert.equal(radiationSeries(recs, 0, Date.parse("2027-01-01")).hours, 1);
  assert.equal(hasRadiation([{ measurementDateTime: "x", swIn: 1 }]), false);
  assert.equal(hasRadiation(recs), true);
});

test("chart config has the three lines and a note", () => {
  const cfg = radiationChartConfig({ records: [rec("2026-11-23T19:00:00Z", 300, 200, 250, 270)], from: 0, to: Date.parse("2027-01-01"), hours: 24, text: "#555", grid: "#ddd" });
  assert.deepEqual(cfg.data.datasets.map((d) => d.label), ["Net radiation", "Net shortwave (sun)", "Net longwave"]);
  assert.match(cfg.options.plugins.title.text, /Avg net \+80 W\/m²/);
});
