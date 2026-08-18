import { getStore } from "@netlify/blobs";

const STORE_NAME = "rockies-weather-archive-v1";
const RETENTION_MS = Math.round(3 * 365.25 * 24 * 60 * 60 * 1000);
export const INITIAL_SEED_HOURS = 720;
const SYNC_OVERLAP_HOURS = 30;

export const STATIONS = {
  "fts-boslo": "6160c6b964699463087281d9",
  "fts-boulder": "6160c6b964699463087281db",
  "fts-bosup": "6160c6b964699463087281dc",
  "fts-vermillion": "6160c6b964699463087281e0",
  "fts-whymper": "6160c6b964699463087281e3",
  "fts-sunshine": "6160c6b964699463087281e8",
  "fts-vulture": "6160c6b964699463087281e9",
  "fts-stanley": "6160c6b964699463087281ea",
  "fts-lakelouise": "6160c6b964699463087281eb",
  "fts-bowsummit": "6160c6b964699463087281ec",
  "fts-castle": "6160c6b964699463087281ef",
  "fts-simplo": "6160c6b964699463087281fa",
  "fts-bowprecip": "6160c6ba6469946308728202",
  "fts-lookout": "6160c6b964699463087281e7",
  "fts-simpup": "6160c6ba6469946308728203",
  "fts-pikarun": "61e09ba56a379f48b21582f6",
  "fts-skoki": "61e09ba56a379f48b21582f7",
  "fts-maligne": "6160c6b36469946308727b36",
  "fts-jasperqd1": "6160c6b964699463087281d0",
  "fts-coleman": "6160c6b36469946308727b25",
  "fts-dorothy": "6160c6b36469946308727b1b",
  "fts-devona": "6160c6b364699463087281a",
  "fts-saskcrossing": "6160c6b36469946308727b30",
  "fts-rangercreek": "6160c6b36469946308727b2a",
  "fts-bigbend": "6160c6a964699463087271e7",
  "fts-tangleridge": "6160c6b36469946308727bca"
};

function archiveStore() {
  return getStore(STORE_NAME);
}

function archiveKey(stationId) {
  return `stations/${stationId}.json`;
}

function asNumber(value) {
  if (value === undefined || value === null || value === "" || value === "/////" || value === "///") {
    return null;
  }
  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function csvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cell += character;
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function canonical(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim().replace(/^"|"$/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const wanted = canonical(alias);
    const key = keys.find((candidate) => canonical(candidate) === wanted);
    if (key !== undefined) {
      const value = asNumber(row[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function findHeaderIndex(lines) {
  return lines.findIndex((line) => {
    const headers = csvLine(line).map(canonical);
    const hasDate = headers.some((name) => ["date", "datetime", "timestamp"].includes(name));
    const hasMeasurement = headers.some((name) => [
      "temp", "ta", "ta2", "hs", "snowheight", "snowdepth", "pc", "pc1", "hw", "precip", "rain", "rainfall", "wspd", "rh"
    ].includes(name));
    return hasDate && hasMeasurement;
  });
}

function parseFtsCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const headerIndex = findHeaderIndex(lines);
  if (headerIndex < 0 || headerIndex >= lines.length - 1) return [];

  const headers = csvLine(lines[headerIndex]).map((value) => String(value).replace(/^\uFEFF/, "").trim().replace(/^"|"$/g, ""));
  const observations = [];

  for (const line of lines.slice(headerIndex + 1)) {
    const cells = csvLine(line);
    if (cells.length < 2) continue;
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });

    const rawTime = row.Date ?? row.date ?? row.DateTime ?? row.Timestamp ?? row.timestamp;
    const date = new Date(rawTime);
    if (!rawTime || !Number.isFinite(date.getTime())) continue;

    const record = { measurementDateTime: date.toISOString() };
    const assign = (name, aliases) => {
      const value = field(row, aliases);
      if (value !== null) record[name] = value;
    };

    assign("airTempAvg", ["Temp", "TA", "TA2", "AirTemp", "Air Temperature"]);
    assign("snowHeight", ["HS", "HS_cm", "SDcm", "SD", "SD2", "Depth", "Snow Height", "Snow Height cm", "Snow Depth", "Snow Depth cm"]);
    assign("newSnow", ["HN24", "HN_24", "HN", "NewSnow", "New Snow", "Rn_1", "SW"]);
    assign("precipTotal", ["HW", "PC", "Precip", "PrecipTotal", "Precip Total", "Precipitation Total", "Accumulated Precipitation", "Rain Total"]);
    assign("precipIncr", ["PC_1", "PC1", "PrecipIncrement", "Precip Increment", "Precipitation Increment", "Rain", "Rainfall", "Rn_1"]);
    assign("windSpeedAvg", ["Wspd", "WindSpeed", "Wind Speed", "WS"]);
    assign("windSpeedGust", ["Mx_Spd", "Gust", "WindGust", "Wind Gust", "Max Wind Speed"]);
    assign("windDirAvg", ["Dir", "Mx_Dir", "WindDir", "Wind Direction"]);
    assign("relativeHumidity", ["Rh", "RH", "RelativeHumidity", "Relative Humidity"]);
    observations.push(record);
  }

  return observations;
}

async function fetchFts(stationId, startDate, endDate = new Date()) {
  const stationHexId = STATIONS[stationId];
  if (!stationHexId) throw new Error(`Unsupported station: ${stationId}`);
  if (!process.env.FTS360_TOKEN) throw new Error("Missing FTS360_TOKEN");

  const url = new URL("https://fts360api.com/data/v1/agencies/450/records/csv");
  url.searchParams.set("stationIds", stationHexId);
  url.searchParams.set("startDate", startDate.toISOString());
  url.searchParams.set("endDate", endDate.toISOString());

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.FTS360_TOKEN}` }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`FTS360 ${response.status}: ${text.slice(0, 200)}`);
  return parseFtsCsv(text);
}

export async function readArchive(stationId) {
  const data = await archiveStore().get(archiveKey(stationId), { type: "json" });
  if (!data || !Array.isArray(data.observations)) {
    return { stationId, observations: [], lastSyncedAt: null, retainedYears: 3 };
  }
  return data;
}

function mergeAndPrune(existing, incoming) {
  const cutoff = Date.now() - RETENTION_MS;
  const byTimestamp = new Map();
  for (const record of [...existing, ...incoming]) {
    const timestamp = new Date(record.measurementDateTime).getTime();
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    byTimestamp.set(record.measurementDateTime, {
      ...(byTimestamp.get(record.measurementDateTime) || {}),
      ...record
    });
  }
  return [...byTimestamp.values()].sort((a, b) => new Date(a.measurementDateTime) - new Date(b.measurementDateTime));
}

async function saveArchive(stationId, observations, extra = {}) {
  const archive = {
    archiveVersion: 1,
    stationId,
    retainedYears: 3,
    lastSyncedAt: new Date().toISOString(),
    observationCount: observations.length,
    ...extra,
    observations
  };
  await archiveStore().setJSON(archiveKey(stationId), archive);
  return archive;
}

export async function syncStation(stationId, seedHours = INITIAL_SEED_HOURS) {
  const archive = await readArchive(stationId);
  const newest = archive.observations.at(-1);
  const newestTime = newest ? new Date(newest.measurementDateTime).getTime() : Number.NaN;
  const start = Number.isFinite(newestTime)
    ? new Date(newestTime - SYNC_OVERLAP_HOURS * 60 * 60 * 1000)
    : new Date(Date.now() - seedHours * 60 * 60 * 1000);

  const incoming = await fetchFts(stationId, start);
  const observations = mergeAndPrune(archive.observations, incoming);
  const saved = await saveArchive(stationId, observations, {
    lastFtsRequestStart: start.toISOString(),
    lastFtsRecordCount: incoming.length
  });
  return { stationId, fetched: incoming.length, retained: saved.observationCount, lastSyncedAt: saved.lastSyncedAt };
}

export function selectHours(archive, requestedHours) {
  const maximumHours = Math.floor(RETENTION_MS / 3_600_000);
  const hours = Math.min(Math.max(Number(requestedHours) || 24, 1), maximumHours);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return archive.observations.filter((record) => new Date(record.measurementDateTime).getTime() >= cutoff);
}
