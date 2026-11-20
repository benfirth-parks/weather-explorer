// Today's SnowpackBC AWSOME stability snapshot for one study plot.
// GET /api/awsome?plot=bow_summit|simpson|goats_eye
// The source site sends no CORS header, so this reads it server side (assets/awsome-data.js).
import {AWSOME_SITE, AWSOME_POINTS, ASPECTS, stamp, summariseAwsome} from "../../assets/awsome-data.js";

const MEMORY_MS = 15 * 60000;
const cache = new Map();
const json = (status, body, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    ...(maxAge ? {"netlify-cdn-cache-control": `public, s-maxage=${maxAge * 3}, stale-while-revalidate=3600`} : {})
  }
});
async function getJSON(path) {
  const res = await fetch(`${AWSOME_SITE}/${path}`, {headers: {accept: "application/json"}});
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
  return res.json();
}

export default async (req) => {
  if (req.method !== "GET") return json(405, {error: "Method not allowed"});
  const plot = new URL(req.url).searchParams.get("plot") || "";
  if (!Object.hasOwn(AWSOME_POINTS, plot)) return json(400, {error: "Unknown plot", plots: Object.keys(AWSOME_POINTS)});
  const hit = cache.get(plot);
  if (hit && Date.now() - hit.at < MEMORY_MS) return json(200, hit.body, 600);
  try {
    const {source, location} = AWSOME_POINTS[plot];
    const config = await getJSON("dcfg/operational.json");
    const ts = stamp(config?.date);
    if (!ts) throw new Error("no current model time");
    const files = Object.fromEntries(await Promise.all(ASPECTS.map(async a => [a, await getJSON(`${source}/geojson/${ts}.${a}.json`)])));
    const zarr = encodeURIComponent(`/opt/awsome/${source}/xsnowpack.zarr`);
    const xs = await getJSON(`nivix/xs?file=${zarr}&location=${encodeURIComponent(location)}&inclination=0&azimuth=0&params=grainshape,hardness,temperature,punstable,layer_of_interest`).catch(() => null);
    const body = summariseAwsome(plot, config.date, files, xs);
    cache.set(plot, {at: Date.now(), body});
    return json(200, body, 600);
  } catch (error) {
    if (hit) return json(200, {...hit.body, stale: true}, 60);
    return json(502, {error: "SnowpackBC AWSOME unavailable", detail: String(error?.message || error)});
  }
};
