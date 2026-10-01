// Read-only archive dump: pulls every station's full retained archive from
// /api/fts and writes gzipped JSON to audit/<stationId>.json.gz so gaps can
// be analysed offline. Never writes to the archive.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const SITE = process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app";
const src = readFileSync("netlify/functions/_weather-archive.mjs", "utf8");
const ids = [...src.matchAll(/"(fts-[a-z0-9]+)":\s*"[0-9a-f]{24}"/g)].map((m) => m[1]);
mkdirSync("audit", { recursive: true });
const summary = {};
for (const id of ids) {
  try {
    const r = await fetch(`${SITE}/api/fts?station=${id}&hours=26298`);
    const obs = await r.json();
    if (!Array.isArray(obs)) throw new Error(JSON.stringify(obs).slice(0, 200));
    writeFileSync(`audit/${id}.json.gz`, gzipSync(JSON.stringify(obs)));
    summary[id] = { count: obs.length, first: obs[0]?.measurementDateTime, last: obs.at(-1)?.measurementDateTime };
  } catch (e) {
    summary[id] = { error: String(e.message || e) };
  }
  console.log(id, JSON.stringify(summary[id]));
}
writeFileSync("audit/summary.json", JSON.stringify({ at: new Date().toISOString(), summary }, null, 1));
