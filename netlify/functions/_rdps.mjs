/* RDPS (GEM Regional, 10 km) hourly precipitation forecast at gauge-checked stations, for the HN back check
   (Ben, 4 Nov 2026; assets/pair-comparison-data.js gaugeCheckedCredits). Fetched from Open-Meteo's GEM API
   (models=gem_regional), which serves Environment Canada's RDPS runs: past hours come from the most recent
   runs that covered them, so "past_days" gives the short-lead forecast for each hour. Open-Meteo's hourly
   precipitation is the total for the hour ending at the timestamp (UTC).
   The HS Sheet sync (benfirth-parks/banff-winter-meeting scripts/sync_snow_sheet.py) makes the same call. */
export const RDPS_POINTS = {
  "fts-sunshine": { latitude: 51.078358, longitude: -115.782455, elevation: 2200 },
  "fts-simplo": { latitude: 50.98507, longitude: -115.984215, elevation: 2115 },
};
export const RDPS_PAST_DAYS = 92;
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
