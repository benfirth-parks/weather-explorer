/* Browser side of the RDPS back check (Ben, 4 Nov 2026): fetches /api/rdps once per station per page load
   (refreshed after 20 min) for the gauge-checked stations in HN_GAUGE_CHECK_IDS. */
import {HN_GAUGE_CHECK_IDS} from './pair-comparison-data.js';
const KEEP_MS = 20 * 60000;
const cache = new Map();
/* Promise of the forecast points [{x, y}] for a station, or null (no RDPS point, or the fetch failed). */
export function rdpsFor(id) {
  if (!HN_GAUGE_CHECK_IDS.has(id)) return Promise.resolve(null);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const item = {at: Date.now(), done: false, points: null};
  item.promise = fetch(`/api/rdps?station=${encodeURIComponent(id)}`)
    .then(r => (r.ok ? r.json() : null)).then(j => (Array.isArray(j?.points) ? j.points : null)).catch(() => null)
    .then(points => { item.points = points; item.done = true; return points; });
  cache.set(id, item);
  return item.promise;
}
/* The forecast if it has loaded: points or null; undefined while still loading (onReady runs when it lands). */
export function rdpsNow(id, onReady) {
  if (!HN_GAUGE_CHECK_IDS.has(id)) return null;
  rdpsFor(id);
  const item = cache.get(id);
  if (item.done) return item.points;
  if (onReady) item.promise.then(() => onReady());
  return undefined;
}
