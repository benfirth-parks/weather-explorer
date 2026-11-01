// Latest simulated and observed snow profile for one study plot, read from the Banff Snowpack site.
// GET /api/plot-profile?plot=bow_summit|simpson|goats_eye|bosworth_lower
// bosworth_lower has no study plot; it reads the BYK Snowpack Model's flat-field run at the station instead.
// The source season files are large and the source site sends no CORS header, so this reads them
// server side and returns only what the paired pane draws (assets/plot-profile-data.js).
import { SNOWPACK_SITE, BYK_SITE, BYK_POINTS, PLOTS, currentSeason, summarisePlot, summariseByk } from "../../assets/plot-profile-data.js";

/* The source rebuilds a few times a day; a warm function reuses its last read for this long. */
const MEMORY_MS = 15 * 60000;
const cache = new Map();
const json = (status, body, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    ...(maxAge ? { "netlify-cdn-cache-control": `public, s-maxage=${maxAge * 3}, stale-while-revalidate=3600` } : {})
  }
});
async function getJSON(path, site = SNOWPACK_SITE) {
  const res = await fetch(`${site}/${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  const plot = new URL(req.url).searchParams.get("plot") || "";
  const byk = Object.hasOwn(BYK_POINTS, plot);
  if (!Object.hasOwn(PLOTS, plot) && !byk) return json(400, { error: "Unknown plot", plots: [...Object.keys(PLOTS), ...Object.keys(BYK_POINTS)] });
  const hit = cache.get(plot);
  if (hit && Date.now() - hit.at < MEMORY_MS) return json(200, hit.body, 600);
  try {
    if (byk) {
      const body = summariseByk(plot, await getJSON(`api/point?id=${encodeURIComponent(BYK_POINTS[plot].id)}`, BYK_SITE));
      cache.set(plot, { at: Date.now(), body });
      return json(200, body, 600);
    }
    const found = currentSeason(await getJSON("data/sites.json"), plot);
    if (!found) return json(404, { error: "No season published for this plot" });
    const body = summarisePlot(plot, found.site, await getJSON(found.season.file));
    cache.set(plot, { at: Date.now(), body });
    return json(200, body, 600);
  } catch (error) {
    if (hit) return json(200, { ...hit.body, stale: true }, 60);
    return json(502, { error: byk ? "BYK Snowpack Model unavailable" : "Banff Snowpack site unavailable", detail: String(error?.message || error) });
  }
};
