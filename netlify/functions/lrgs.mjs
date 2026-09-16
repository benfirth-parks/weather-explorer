// LRGS data endpoint — serves NOAA GOES-DCP messages ingested by the
// scripts/lrgs_ingest.py worker and committed to data/lrgs/ every 15 min.
//
// GET /api/lrgs                 -> manifest (latest reading per station)
// GET /api/lrgs?station=fts-boslo
//                               -> latest reading for one station
// GET /api/lrgs?station=fts-boslo&history=24
//                               -> last N hours of raw messages
//
// Response always includes { source: "noaa-lrgs", generated_at, ... }
// so the frontend can distinguish real observations from Open-Meteo model
// fallback.
//
// When ingestion has never run (no data/lrgs/latest.json), returns 503 with
// { error: "no-lrgs-data-yet" } so index2.html can fall back cleanly.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = new URL("../../data/lrgs/", import.meta.url).pathname;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

async function readManifest() {
  try {
    const raw = await readFile(join(DATA_DIR, "latest.json"), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

async function readStationHistory(stationId, hoursBack) {
  const dir = join(DATA_DIR, stationId);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const rows = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const obj = JSON.parse(raw);
      const t = obj.arrival_time ? Date.parse(obj.arrival_time) : NaN;
      if (Number.isNaN(t) || t >= cutoff) rows.push(obj);
    } catch { /* skip corrupt file */ }
  }
  rows.sort((a, b) =>
    (a.arrival_time || "").localeCompare(b.arrival_time || "")
  );
  return rows;
}

export default async (req) => {
  const url = new URL(req.url);
  const station = url.searchParams.get("station");
  const history = Number(url.searchParams.get("history") || "0");

  try {
    if (station && history > 0) {
      const rows = await readStationHistory(station, history);
      return json(200, {
        source: "noaa-lrgs",
        station,
        hours: history,
        count: rows.length,
        messages: rows,
      });
    }

    const manifest = await readManifest();
    if (!manifest) {
      return json(503, {
        source: "noaa-lrgs",
        error: "no-lrgs-data-yet",
        message:
          "LRGS ingestion has not produced data yet. " +
          "Register at NOAA/Wallops (757) 824-7450 and add " +
          "LRGS_USER + LRGS_PASSWORD to the repo secrets.",
      });
    }

    if (station) {
      const row = manifest.stations?.[station];
      if (!row) return json(404, { source: "noaa-lrgs", error: "unknown-station", station });
      return json(200, {
        source: "noaa-lrgs",
        generated_at: manifest.generated_at,
        station,
        reading: row,
      });
    }

    return json(200, {
      source: "noaa-lrgs",
      generated_at: manifest.generated_at,
      server: manifest.server,
      protocol_version: manifest.protocol_version,
      station_count: manifest.station_count,
      stations: manifest.stations,
    });
  } catch (e) {
    return json(500, {
      source: "noaa-lrgs",
      error: "internal-error",
      message: String(e?.message || e),
    });
  }
};

export const config = { path: "/api/lrgs" };
