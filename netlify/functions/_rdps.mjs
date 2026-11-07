/* RDPS (GEM Regional, 10 km) hourly precipitation forecast at the HN-checked stations (HN_GAUGE_CHECK_IDS), for the HN back check
   (Ben, 4 Nov 2026; assets/pair-comparison-data.js gaugeCheckedCredits). Fetched from Open-Meteo's GEM API
   (models=gem_regional), which serves Environment Canada's RDPS runs: past hours come from the most recent
   runs that covered them, so "past_days" gives the short-lead forecast for each hour. Open-Meteo's hourly
   precipitation is the total for the hour ending at the timestamp (UTC).
   The HS Sheet sync (benfirth-parks/banff-winter-meeting scripts/sync_snow_sheet.py) makes the same call. */
export const RDPS_POINTS = {
  "fts-sunshine": { latitude: 51.078358, longitude: -115.782455, elevation: 2200 },
  "fts-simplo": { latitude: 50.98507, longitude: -115.984215, elevation: 2115 },
  "fts-boslo": { latitude: 51.45722, longitude: -116.357834, elevation: 2210 },
  "fts-bowsummit": { latitude: 51.709373, longitude: -116.47904, elevation: 2040 },
  "fts-stanley": { latitude: 51.184673, longitude: -116.0892, elevation: 1930 },
  "fts-bowprecip": { latitude: 51.712, longitude: -116.481, elevation: 2040 },
  "fts-pikarun": { latitude: 51.442, longitude: -116.217, elevation: 2200 },
  "fts-coleman": { latitude: 52.09691, longitude: -116.92602, elevation: 2176 },
  "fts-bigbend": { latitude: 52.193, longitude: -117.156, elevation: 2125 },
  "fts-maligne": { latitude: 52.7244, longitude: -117.6494, elevation: 1712 },
  "fts-summitlake": { latitude: 49.006447, longitude: -114.03637, elevation: 2056 },
  "fts-akamina": { latitude: 49.0333, longitude: -114.05, elevation: 1676 },
};
export const RDPS_PAST_DAYS = 92;
import { NEIGHBOUR_GAUGE_IDS, hourlyGauge } from "../../assets/pair-comparison-data.js";
const KEEP_MS = 20 * 60000;
const cache = new Map();

export function rdpsUrl(id, pastDays = RDPS_PAST_DAYS) {
  const p = RDPS_POINTS[id];
  if (!p) return null;
  const q = new URLSearchParams({
    latitude: p.latitude, longitude: p.longitude, elevation: p.elevation,
    hourly: "precipitation", models: "gem_regional", past_days: pastDays, forecast_days: 1, timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/gem?${q}`;
}
/* Open-Meteo hourly JSON -> [{x: hour end (ms), y: mm}], dropping hours with no value. */
export function rdpsPoints(json) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.precipitation)) throw new Error("unexpected RDPS response");
  return h.time.map((t, i) => ({ x: Date.parse(`${t}Z`), y: h.precipitation[i] }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0);
}
/* The forecast points for a station, or null when it has none or the fetch fails (the HN rule then
   runs without the back check). */
export async function fetchRdps(id, { fetchImpl = fetch } = {}) {
  const url = rdpsUrl(id);
  if (!url) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.points;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const points = rdpsPoints(await res.json());
    cache.set(id, { at: Date.now(), points });
    return points;
  } catch (e) {
    console.warn(JSON.stringify({ event: "rdps-fetch-failed", id, error: e.message }));
    return hit ? hit.points : null;
  }
}

/* RDPS points plus, for a station in NEIGHBOUR_GAUGE_IDS (Simpson Lower: Vermillion), the neighbour's hourly
   gauge increments as `neighbourGauge` on the returned array (assets/pair-comparison-data.js
   gaugeCheckedCredits). null when there is no RDPS forecast. */
export async function fetchBackCheck(id, { fetchImpl = fetch, readArchiveImpl = null } = {}) {
  const points = await fetchRdps(id, { fetchImpl });
  const neighbour = NEIGHBOUR_GAUGE_IDS[id];
  if (!points || !neighbour) return points;
  const out = [...points];
  try {
    const read = readArchiveImpl || (await import("./_weather-archive.mjs")).readArchive;
    const archive = await read(neighbour);
    const now = Date.now();
    out.neighbourGauge = hourlyGauge(archive.observations || [], now - RDPS_PAST_DAYS * 24 * 3600000, now);
    out.neighbourId = neighbour;
  } catch (e) {
    console.warn(JSON.stringify({ event: "neighbour-gauge-failed", id, neighbour, error: e.message }));
  }
  return out;
}
