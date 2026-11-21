/* Avalanche Canada backup feed.
   Avalanche Canada reads the same Parks Canada stations straight from the
   NOAA GOES satellite feed, independently of FTS360. It is the last source:
   when both our own NOAA feed and FTS360 fall more than BACKUP_AFTER_HOURS
   behind, the sync fills the hours after the newest
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
  "fts-tangleridge": 129,
  "fts-summitlake": 124,
  "fts-waterton": 125,
  "fts-akamina": 126
};

/* Group 6 · Kananaskis (Ben, 21 Nov 2026; the stations of his K-Country Wx Actuals site,
   benfirth-parks/kcountry-wx-actuals). Kananaskis Country's own network: Avalanche Canada is
   their only feed (no NOAA or FTS360 here), so for these it is the primary source, not a
   backup. No precipitation gauge; Aster Lake has no depth sensor. */
export const AVCAN_ONLY_STATION_IDS = {
  "kc-rundle": 159,
  "kc-mudlake": 3,
  "kc-burstall": 1,
  "kc-aster": 4,
  "kc-highwood": 5
};
export const isAvcanOnly = (stationId) => Object.hasOwn(AVCAN_ONLY_STATION_IDS, stationId);
/* Hours re-read before the newest Avalanche Canada-only record, to pick up late or revised hours. */
const AVCAN_ONLY_OVERLAP_HOURS = 6;

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

/* Records carry the source that supplied them: none (FTS360), "noaa" or
   "avalanche-canada". A NOAA record that FTS360 also delivered is marked
   ftsSeen: true. */
const isFtsRecord = (r) => !!r && (!r.source || r.ftsSeen === true);
const isPrimaryRecord = (r) => !!r && !isBackupRecord(r);

function newestTime(observations, keep) {
  for (let i = observations.length - 1; i >= 0; i--) {
    const r = observations[i];
    if (!keep(r)) continue;
    const t = new Date(r.measurementDateTime).getTime();
    if (Number.isFinite(t)) return t;
  }
  return Number.NaN;
}

/** Time (ms) of the newest record FTS360 delivered (sets the FTS360 request window). */
export const newestFtsTime = (observations) => newestTime(observations, isFtsRecord);

/** Time (ms) of the newest NOAA or FTS360 record, ignoring backup records. */
export const newestPrimaryTime = (observations) => newestTime(observations, isPrimaryRecord);

/** Backup records strictly after the newest FTS360 record, sorted. */
export function backupRecordsAfter(measurements, afterMs) {
  return (Array.isArray(measurements) ? measurements : [])
    .map(convertMeasurement)
    .filter((r) => r && new Date(r.measurementDateTime).getTime() > afterMs)
    .sort((a, b) => new Date(a.measurementDateTime) - new Date(b.measurementDateTime));
}

/* Snow-depth spike filter for the Avalanche Canada-only stations (from the K-Country site):
   East End of Rundle reads ~0 cm and then 28 or 146 cm for a single hour. A depth more than
   15 cm from the median of the 3 h either side is dropped. Records sorted oldest first. */
export function despike(records) {
  const hs = records.map((r) => (typeof r.snowHeight === "number" && Number.isFinite(r.snowHeight) ? r.snowHeight : null));
  return records.map((r, i) => {
    if (hs[i] == null) return r;
    const lo = Math.max(0, i - 3);
    const nb = hs.slice(lo, i + 4).filter((v, j) => v != null && j !== i - lo).sort((a, b) => a - b);
    if (!nb.length) return r;
    const med = nb[Math.floor(nb.length / 2)];
    // null (not left out) so the merge also clears a spike an earlier sync kept.
    return Math.abs(hs[i] - med) > 15 ? { ...r, snowHeight: null, hsDespiked: true } : r;
  });
}

/** Fetches backup records for a station when NOAA and FTS360 are both behind; [] otherwise.
    For an Avalanche Canada-only station (Kananaskis) it fetches every sync, from a few hours
    before its newest record. */
export async function fetchBackup(stationId, observations, { now = Date.now(), fetchImpl = fetch } = {}) {
  const only = isAvcanOnly(stationId);
  const avcanId = only ? AVCAN_ONLY_STATION_IDS[stationId] : AVCAN_STATION_IDS[stationId];
  if (!avcanId) return [];
  const newest = only ? newestTime(observations, () => true) : newestPrimaryTime(observations);
  if (!only && Number.isFinite(newest) && now - newest < BACKUP_AFTER_HOURS * 3600 * 1000) return [];
  const after = only && Number.isFinite(newest) ? newest - AVCAN_ONLY_OVERLAP_HOURS * 3600 * 1000 : newest;
  const from = Math.max(Number.isFinite(after) ? after : 0, now - MAX_BACKFILL_DAYS * 86400 * 1000);
  const url = new URL(`${AVCAN_BASE}/stations/${avcanId}/measurements`);
  url.searchParams.set("fromDate", new Date(from).toISOString());
  url.searchParams.set("toDate", new Date(now).toISOString());
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Avalanche Canada ${res.status}`);
  const body = await res.json();
  // The API returns a bare array (newest first); the docs show { measurements: [...] }.
  const list = Array.isArray(body) ? body : body && body.measurements;
  const recs = backupRecordsAfter(list, Number.isFinite(after) ? after : -Infinity);
  return only ? despike(recs) : recs;
}
