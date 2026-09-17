// One-shot historical import endpoint.
// Accepts a JSON payload of pre-normalized observations for one station,
// merges them into the existing Netlify Blob archive at
// stations/<stationId>.json, and returns before/after counts.
//
// Overlap policy: EXISTING WINS. If a record for the same
// measurementDateTime is already present in the archive, the incoming row
// is dropped in favour of the existing one (opposite of the live sync's
// "incoming wins" behaviour) — matches user's "just use the existing
// archive" instruction for the overlap window.
//
// Auth: x-admin-token header must equal env.ARCHIVE_ADMIN_TOKEN
// (same secret used by fts-sync-manual).
//
// Body:
//   {
//     "stationId": "fts-boslo",
//     "observations": [
//       { "measurementDateTime": "2024-01-01T07:00:00.000Z",
//         "airTempAvg": -4.7, "snowHeight": 83.3, ... },
//       ...
//     ]
//   }
//
// Response:
//   {
//     "ok": true,
//     "stationId": "fts-boslo",
//     "incoming": 500,
//     "existingBefore": 1234,
//     "kept": 1400,
//     "newlyAdded": 166,
//     "overlapKeptExisting": 334,
//     "droppedByRetention": 0,
//     "totalAfter": 1400,
//     "lastSyncedAt": "..."
//   }

import { getStore } from "@netlify/blobs";

const STORE_NAME = "rockies-weather-archive-v1";
const RETENTION_MS = Math.round(3 * 365.25 * 24 * 60 * 60 * 1000);
const KNOWN_FIELDS = new Set([
  "measurementDateTime",
  "airTempAvg", "airTempMin", "airTempMax",
  "snowHeight", "newSnow",
  "precipTotal", "precipIncr",
  "windSpeedAvg", "windSpeedGust",
  "windDirAvg", "windDirPeak",
  "relativeHumidity"
]);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function archiveKey(stationId) { return `stations/${stationId}.json`; }

export default async (req) => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method-not-allowed" });
  }
  const adminToken = req.headers.get("x-admin-token");
  if (!process.env.ARCHIVE_ADMIN_TOKEN || adminToken !== process.env.ARCHIVE_ADMIN_TOKEN) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return json(400, { ok: false, error: "invalid-json", message: String(e?.message || e) });
  }

  const stationId = String(payload?.stationId || "").trim();
  const incoming = Array.isArray(payload?.observations) ? payload.observations : null;
  if (!stationId || !incoming) {
    return json(400, { ok: false, error: "missing-fields", need: ["stationId", "observations[]"] });
  }
  if (incoming.length > 20000) {
    return json(413, { ok: false, error: "chunk-too-large", max: 20000, got: incoming.length });
  }

  const store = getStore(STORE_NAME);
  const existing = await store.get(archiveKey(stationId), { type: "json" });
  const existingObservations = existing?.observations && Array.isArray(existing.observations)
    ? existing.observations : [];
  const existingBefore = existingObservations.length;

  // Merge with EXISTING WINS
  const cutoff = Date.now() - RETENTION_MS;
  const byTs = new Map();
  // seed with existing (retention already applied historically)
  for (const rec of existingObservations) {
    const t = new Date(rec.measurementDateTime).getTime();
    if (!Number.isFinite(t)) continue;
    // do NOT re-apply cutoff to existing records — trust what's there
    byTs.set(rec.measurementDateTime, rec);
  }
  let newlyAdded = 0;
  let overlapKeptExisting = 0;
  let droppedByRetention = 0;
  let droppedInvalid = 0;

  for (const rec of incoming) {
    const iso = String(rec?.measurementDateTime || "");
    const t = new Date(iso).getTime();
    if (!iso || !Number.isFinite(t)) { droppedInvalid++; continue; }
    if (t < cutoff) { droppedByRetention++; continue; }
    if (byTs.has(iso)) { overlapKeptExisting++; continue; }
    // sanitize to known fields only (schema unchanged)
    const clean = {};
    for (const [k, v] of Object.entries(rec)) {
      if (KNOWN_FIELDS.has(k) && v !== null && v !== undefined) clean[k] = v;
    }
    if (!clean.measurementDateTime) { droppedInvalid++; continue; }
    byTs.set(iso, clean);
    newlyAdded++;
  }

  const merged = [...byTs.values()]
    .sort((a, b) => new Date(a.measurementDateTime) - new Date(b.measurementDateTime));

  const archive = {
    archiveVersion: 1,
    stationId,
    retainedYears: 3,
    lastSyncedAt: existing?.lastSyncedAt || new Date().toISOString(),
    lastHistoricalImportAt: new Date().toISOString(),
    observationCount: merged.length,
    observations: merged
  };
  // preserve any other fields the live sync writes
  if (existing?.lastFtsRequestStart) archive.lastFtsRequestStart = existing.lastFtsRequestStart;
  if (existing?.lastFtsRecordCount !== undefined) archive.lastFtsRecordCount = existing.lastFtsRecordCount;

  await store.setJSON(archiveKey(stationId), archive);

  return json(200, {
    ok: true,
    stationId,
    incoming: incoming.length,
    existingBefore,
    kept: merged.length,
    newlyAdded,
    overlapKeptExisting,
    droppedByRetention,
    droppedInvalid,
    totalAfter: merged.length,
    lastSyncedAt: archive.lastSyncedAt,
    lastHistoricalImportAt: archive.lastHistoricalImportAt
  });
};

export const config = { path: "/api/import-historical" };
