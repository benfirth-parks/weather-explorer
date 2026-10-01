// Admin endpoint: write one station-year of long-term history to
// history/<stationId>/<year>.json (replaces that year file).
// Auth: x-admin-token must equal env.ARCHIVE_ADMIN_TOKEN.
// Body: { stationId, year, source?, observations: [{ measurementDateTime, ... }] }
import { getStore } from "@netlify/blobs";
import { STATIONS, historyKey } from "./_weather-archive.mjs";

const STORE_NAME = "rockies-weather-archive-v1";
const KNOWN_FIELDS = new Set([
  "measurementDateTime", "airTempAvg", "airTempMin", "airTempMax",
  "snowHeight", "newSnow", "precipTotal", "precipIncr",
  "windSpeedAvg", "windSpeedGust", "windDirAvg", "windDirPeak", "relativeHumidity"
]);
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method-not-allowed" });
  if (!process.env.ARCHIVE_ADMIN_TOKEN || req.headers.get("x-admin-token") !== process.env.ARCHIVE_ADMIN_TOKEN) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  let body;
  try { body = await req.json(); } catch (e) { return json(400, { ok: false, error: "invalid-json" }); }
  const stationId = String(body?.stationId || "");
  const year = Number(body?.year);
  const obs = Array.isArray(body?.observations) ? body.observations : null;
  if (!STATIONS[stationId] || !Number.isInteger(year) || year < 1990 || !obs) {
    return json(400, { ok: false, error: "bad-request", need: ["stationId", "year", "observations[]"] });
  }
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
  const clean = [];
  let dropped = 0;
  for (const r of obs) {
    const t = new Date(r?.measurementDateTime).getTime();
    if (!Number.isFinite(t) || t < start || t >= end) { dropped++; continue; }
    const c = {};
    for (const [k, v] of Object.entries(r)) if (KNOWN_FIELDS.has(k) && v !== null && v !== undefined) c[k] = v;
    clean.push(c);
  }
  clean.sort((a, b) => new Date(a.measurementDateTime) - new Date(b.measurementDateTime));
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  await store.setJSON(historyKey(stationId, year), {
    stationId, year, source: String(body?.source || "historical-import"),
    writtenAt: new Date().toISOString(), observationCount: clean.length, observations: clean
  });
  return json(200, { ok: true, mode: "history-put", stationId, year, written: clean.length, dropped });
};

export const config = { path: "/api/history-put" };
