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
  "fts-devona": "6160c6b36469946308727b1a",
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

/* Locate the CSV header row. FTS360 prepends metadata lines before the real
   header, so we scan for the first row that has both a date-like column AND at
   least one sensor column. The sensor whitelist deliberately covers the short
   codes AND the long "Avg X" / "Peak X" wordings a station may use, so a
   config that publishes only e.g. "Date, AvgTemp, AvgWindSpeed, PeakWindSpeed"
   is still recognised as the header. */
function findHeaderIndex(lines) {
  const measurementTokens = new Set([
    "temp", "ta", "ta2", "airtemp", "airtemperature",
    "atcavg", "atcmin", "atcmax",
    "avgt", "avgtemp", "avgtemperature", "averagetemp", "averagetemperature",
    "avgairtemp", "avgairtemperature", "averageairtemp", "averageairtemperature",
    "meantemp", "meantemperature",
    "hs", "hscm", "sd", "sd2", "sdcm", "depth", "snowheight", "snowdepth",
    "hn", "hn24", "newsnow",
    "pc", "pc1", "hw", "precip", "preciptotal", "precipitationtotal",
    "precipincrement", "precipincr", "rain", "rainfall", "raintotal",
    "ws", "wspd", "windspeed", "avgws", "peakws",
    "avgwspd", "avgwindspeed", "averagewindspeed", "averagewspd",
    "meanwspd", "meanwindspeed",
    "gust", "windgust", "mxspd", "maxwind", "maxwindspeed", "maxwspd",
    "peakwind", "peakwindspeed", "peakwspd", "peakgust",
    "wd", "avgwd", "peakwd",
    "dir", "mxdir", "winddir", "winddirection",
    "avgdir", "avgwinddir", "avgwinddirection", "averagewinddir", "averagewinddirection",
    "peakdir", "peakwinddir", "peakwinddirection",
    "rh", "rhavg", "relativehumidity",
    "avgrh", "averagerh", "averagerelativehumidity"
  ]);
  return lines.findIndex((line) => {
    const headers = csvLine(line).map(canonical);
    const hasDate = headers.some((name) => ["date", "datetime", "timestamp"].includes(name));
    const hasMeasurement = headers.some((name) => measurementTokens.has(name));
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

    /* Aliases are matched via canonical() which strips punctuation and case,
       so "Avg Wind Speed", "Avg_Wind_Speed", "AvgWindSpeed", and "avg-wind-speed"
       all resolve to the same key. Only the wording variants need to be listed. */
    /* ATCAvg / ATCMin / ATCMax = Air Temperature (Celsius) Avg/Min/Max, the
       header names FTS360 uses for Coleman, Big Bend, and Tangle Ridge. */
    assign("airTempAvg", [
      "ATCAvg", "ATC Avg", "ATC_Avg",
      "Temp", "TA", "TA2",
      "AirTemp", "Air Temp", "Air Temperature",
      "AvgT", "AvgTemp", "Avg Temp", "Avg Temperature",
      "Average Temp", "Average Temperature",
      "Avg Air Temp", "Avg Air Temperature",
      "Average Air Temp", "Average Air Temperature",
      "MeanTemp", "Mean Temperature"
    ]);
    assign("airTempMin", ["ATCMin", "ATC Min", "ATC_Min", "TempMin", "Min Temp", "Minimum Temperature", "Air Temp Min"]);
    assign("airTempMax", ["ATCMax", "ATC Max", "ATC_Max", "TempMax", "Max Temp", "Maximum Temperature", "Air Temp Max"]);
    assign("snowHeight", ["HS", "HS_cm", "SDcm", "SD", "SD2", "Depth", "Snow Height", "Snow Height cm", "Snow Depth", "Snow Depth cm"]);
    assign("newSnow", ["HN24", "HN_24", "HN", "NewSnow", "New Snow", "Rn_1", "SW"]);
    assign("precipTotal", ["HW", "PC", "Precip", "PrecipTotal", "Precip Total", "Precipitation Total", "Accumulated Precipitation", "Rain Total"]);
    assign("precipIncr", ["PC_1", "PC1", "PrecipIncrement", "Precip Increment", "Precipitation Increment", "Rain", "Rainfall", "Rn_1"]);
    /* AvgWS / PeakWS / AvgWD / PeakWD / RHAvg = the actual header names
       FTS360 uses for these avalanche-safety stations. */
    assign("windSpeedAvg", [
      "AvgWS", "Avg WS", "AvgWspd", "Avg Wspd",
      "Wspd", "WS", "WindSpeed", "Wind Speed",
      "AvgWindSpeed", "Avg Wind Speed",
      "Average Wind Speed", "Average Wspd",
      "MeanWspd", "Mean Wind Speed"
    ]);
    assign("windSpeedGust", [
      "PeakWS", "Peak WS", "Peak Wspd", "PeakWspd",
      "Peak Wind", "PeakWind", "Peak Wind Speed", "Peak Gust", "PeakGust",
      "Mx_Spd", "MxSpd", "Mx Spd", "Max Spd",
      "Gust", "WindGust", "Wind Gust",
      "Max Wind", "Max Wind Speed", "MaxWspd", "Max Wspd",
      "Wspd Peak", "Wind Speed Peak"
    ]);
    assign("windDirAvg", [
      "AvgWD", "Avg WD", "AvgWDir", "Avg WDir",
      "Dir", "Mx_Dir", "MxDir", "WindDir", "Wind Dir", "Wind Direction",
      "AvgDir", "Avg Dir", "AvgWindDir", "Avg Wind Dir", "Avg Wind Direction",
      "Average Wind Dir", "Average Wind Direction"
    ]);
    assign("windDirPeak", [
      "PeakWD", "Peak WD", "Peak Dir", "PeakDir", "Peak Wind Dir", "Peak Wind Direction"
    ]);
    assign("relativeHumidity", [
      "RHAvg", "RH Avg", "RH_Avg",
      "Rh", "RH", "RelativeHumidity", "Relative Humidity",
      "AvgRh", "Avg Rh", "Avg RH", "Average Rh", "Average Relative Humidity"
    ]);
    observations.push(record);
  }

  return observations;
}

async function fetchFtsRaw(stationId, startDate, endDate = new Date()) {
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
  return text;
}

async function fetchFts(stationId, startDate, endDate = new Date()) {
  const text = await fetchFtsRaw(stationId, startDate, endDate);
  return parseFtsCsv(text);
}

/* Diagnostic: return the raw CSV header row + a sample data row so we can see
   exactly which sensor columns a station publishes without dumping the whole
   archive. Used by /api/fts-inspect. */
export async function inspectStationHeaders(stationId, hours = 48) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);
  const text = await fetchFtsRaw(stationId, startDate, endDate);
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const headerIndex = findHeaderIndex(lines);
  const preHeader = headerIndex > 0 ? lines.slice(0, headerIndex) : [];
  const headers = headerIndex >= 0 ? csvLine(lines[headerIndex]).map((v) => String(v).replace(/^\uFEFF/, "").trim().replace(/^"|"$/g, "")) : [];
  const sampleRows = headerIndex >= 0 ? lines.slice(headerIndex + 1, headerIndex + 4).map((line) => {
    const cells = csvLine(line);
    const row = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ""; });
    return row;
  }) : [];
  return {
    stationId,
    stationHexId: STATIONS[stationId],
    windowStart: startDate.toISOString(),
    windowEnd: endDate.toISOString(),
    lineCount: lines.length,
    headerIndex,
    preHeaderLines: preHeader,
    headers,
    sampleRows
  };
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

/* Sync every station in parallel with Promise.allSettled so a single
   station's failure does not kill the whole batch. Returns a structured
   result object suitable for JSON responses and logs. Used by both the
   scheduled `fts-sync` function and the token-gated `fts-sync-manual`
   webhook so the two share exactly one code path. */
export async function syncAllStations({ seedHours = INITIAL_SEED_HOURS } = {}) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const settled = await Promise.allSettled(
    Object.keys(STATIONS).map((stationId) => syncStation(stationId, seedHours))
  );

  const results = settled.map((r, i) => {
    const stationId = Object.keys(STATIONS)[i];
    if (r.status === "fulfilled") return { stationId, ok: true, ...r.value };
    return { stationId, ok: false, error: r.reason?.message || String(r.reason) };
  });

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const durationMs = Date.now() - startMs;

  return {
    event: "fts-archive-sync",
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs,
    total: results.length,
    succeeded,
    failed,
    results
  };
}

export function selectHours(archive, requestedHours) {
  const maximumHours = Math.floor(RETENTION_MS / 3_600_000);
  const hours = Math.min(Math.max(Number(requestedHours) || 24, 1), maximumHours);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return archive.observations.filter((record) => new Date(record.measurementDateTime).getTime() >= cutoff);
}
