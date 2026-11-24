/* RDPS (GEM Regional, 10 km) hourly precipitation forecast at the HN-checked stations (HN_GAUGE_CHECK_IDS), for the HN back check
   (Ben, 4 Nov 2026; assets/pair-comparison-data.js gaugeCheckedCredits). Fetched from Open-Meteo's GEM API
   (models=gem_regional), which serves Environment Canada's RDPS runs: past hours come from the most recent
   runs that covered them, so "past_days" gives the short-lead forecast for each hour. Open-Meteo's hourly
   precipitation is the total for the hour ending at the timestamp (UTC).
   The HS Sheet sync (benfirth-parks/banff-winter-meeting scripts/sync_snow_sheet.py) makes the same call. */
export const RDPS_POINTS = {
  "fts-sunshine": { latitude: 51.08888, longitude: -115.75452, elevation: 2200 },
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
  "fts-akamina": { latitude: 49.0346, longitude: -114.05459, elevation: 1676 },
  "kc-rundle": { latitude: 51.07323, longitude: -115.40978, elevation: 1700 },
  "kc-mudlake": { latitude: 50.794167, longitude: -115.30714, elevation: 1900 },
  "kc-burstall": { latitude: 50.758183, longitude: -115.36667, elevation: 2300 },
  "kc-highwood": { latitude: 50.598618, longitude: -114.98721, elevation: 2250 },
};
export const RDPS_PAST_DAYS = 92;
import { NEIGHBOUR_GAUGE_IDS, HN_NO_GAUGE_IDS, hourlyGauge, gaugeOfflinePeriods } from "../../assets/pair-comparison-data.js";
import { cleanGaugeSpikes } from "../../assets/gauge-spikes.js";
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
   gauge increments as `neighbourGauge` on the returned array, and, for a station with its own gauge, the times
   that gauge was not reporting as `gaugeOffline` ([{start, end}], end null while it still is; Ben, 24 Nov 2026)
   (assets/pair-comparison-data.js gaugeCheckedCredits, gaugeOfflinePeriods). null when there is no RDPS forecast. */
export async function fetchBackCheck(id, { fetchImpl = fetch, readArchiveImpl = null } = {}) {
  const points = await fetchRdps(id, { fetchImpl });
  const neighbour = NEIGHBOUR_GAUGE_IDS[id];
  const ownGauge = !HN_NO_GAUGE_IDS.has(id);
  if (!points || (!neighbour && !ownGauge)) return points;
  const out = [...points];
  const now = Date.now();
  let read = readArchiveImpl;
  const reader = async () => read || (read = (await import("./_weather-archive.mjs")).readArchive);
  if (ownGauge) {
    try {
      const archive = await (await reader())(id);
      const from = now - (RDPS_PAST_DAYS + 1) * 24 * 3600000;
      const obs = (archive.observations || []).filter(r => Date.parse(r.measurementDateTime) >= from);
      out.gaugeOffline = gaugeOfflinePeriods(cleanGaugeSpikes(obs), points, now);
    } catch (e) {
      console.warn(JSON.stringify({ event: "gauge-offline-failed", id, error: e.message }));
    }
  }
  if (neighbour) {
    try {
      const archive = await (await reader())(neighbour);
      out.neighbourGauge = hourlyGauge(cleanGaugeSpikes(archive.observations || []), now - RDPS_PAST_DAYS * 24 * 3600000, now);
      out.neighbourId = neighbour;
    } catch (e) {
      console.warn(JSON.stringify({ event: "neighbour-gauge-failed", id, neighbour, error: e.message }));
    }
  }
  return out;
}
