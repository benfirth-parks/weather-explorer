/* Avalanche Canada backup feed.
   Avalanche Canada reads the same Parks Canada stations straight from the
   NOAA GOES satellite feed, independently of FTS360. When FTS360 falls more
   than BACKUP_AFTER_HOURS behind, the sync fills the hours after the newest
   FTS360 reading from Avalanche Canada's public weather API. Those records
   carry source: "avalanche-canada"; once FTS360 catches up, its own records
   replace them (see mergeAndPrune in _weather-archive.mjs).

   API docs: https://avalanche.ca/api-docs (base https://weather.prod.avalanche.ca)
   Only fields that match the FTS360 records one-for-one are copied: snow
   height (cm), air temperature (°C), wind (km/h, degrees) and RH (%). Precip
   and the feed's new-snow fields are left out, so HW comes only from FTS360. */

export const AVCAN_BASE = "https://weather.prod.avalanche.ca";
export const AVCAN_SOURCE = "avalanche-canada";
export const BACKUP_AFTER_HOURS = 3;
const MAX_BACKFILL_DAYS = 7;

/* FTS360 archive id -> Avalanche Canada stationId (all "Parks Canada"
   source on their side; checked against matching FTS360 hours). */
export const AVCAN_STATION_IDS = {
  "fts-simplo": 106,
  "fts-simpup": 107,
  "fts-stanley": 108,
  "fts-whymper": 109,
  "fts-boslo": 110,
  "fts-bosup": 111,
  "fts-bowsummit": 112,
  "fts-vulture": 113,
  "fts-bigbend": 115,
  "fts-coleman": 116,
  "fts-boulder": 117,
  "fts-lookout": 121,
  "fts-sunshine": 122,
  "fts-maligne": 123,
  "fts-tangleridge": 129
};

const FIELD_MAP = {
  snowHeight: "snowHeight",
  airTempAvg: "airTempAvg",
  airTempMax: "airTempMax",
  airTempMin: "airTempMin",
  windSpeedAvg: "windSpeedAvg",
  windSpeedGust: "windSpeedGust",
  windDirAvg: "windDirAvg",
  windDirGust: "windDirPeak",
  relativeHumidity: "relativeHumidity"
};

export const isBackupRecord = (r) => !!(r && r.source === AVCAN_SOURCE);

/** One Avalanche Canada measurement -> archive record, or null. */
export function convertMeasurement(m) {
  const t = new Date(m && m.measurementDateTime);
  if (!Number.isFinite(t.getTime())) return null;
  const rec = { measurementDateTime: t.toISOString(), source: AVCAN_SOURCE };
  let any = false;
  for (const [from, to] of Object.entries(FIELD_MAP)) {
    const v = m[from];
    if (typeof v === "number" && Number.isFinite(v)) {
      rec[to] = v;
      any = true;
    }
  }
  return any ? rec : null;
}

/** Time (ms) of the newest FTS360 record, ignoring backup records. */
export function newestFtsTime(observations) {
  for (let i = observations.length - 1; i >= 0; i--) {
    const r = observations[i];
    if (isBackupRecord(r)) continue;
    const t = new Date(r.measurementDateTime).getTime();
    if (Number.isFinite(t)) return t;
  }
  return Number.NaN;
}

/** Backup records strictly after the newest FTS360 record, sorted. */
export function backupRecordsAfter(measurements, afterMs) {
  return (Array.isArray(measurements) ? measurements : [])
    .map(convertMeasurement)
    .filter((r) => r && new Date(r.measurementDateTime).getTime() > afterMs)
    .sort((a, b) => new Date(a.measurementDateTime) - new Date(b.measurementDateTime));
}

/** Fetches backup records for a station when FTS360 is behind; [] otherwise. */
export async function fetchBackup(stationId, observations, { now = Date.now(), fetchImpl = fetch } = {}) {
  const avcanId = AVCAN_STATION_IDS[stationId];
  if (!avcanId) return [];
  const newest = newestFtsTime(observations);
  if (Number.isFinite(newest) && now - newest < BACKUP_AFTER_HOURS * 3600 * 1000) return [];
  const from = Math.max(Number.isFinite(newest) ? newest : 0, now - MAX_BACKFILL_DAYS * 86400 * 1000);
  const url = new URL(`${AVCAN_BASE}/stations/${avcanId}/measurements`);
  url.searchParams.set("fromDate", new Date(from).toISOString());
  url.searchParams.set("toDate", new Date(now).toISOString());
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Avalanche Canada ${res.status}`);
  const body = await res.json();
  // The API returns a bare array (newest first); the docs show { measurements: [...] }.
  const list = Array.isArray(body) ? body : body && body.measurements;
  return backupRecordsAfter(list, Number.isFinite(newest) ? newest : -Infinity);
}
