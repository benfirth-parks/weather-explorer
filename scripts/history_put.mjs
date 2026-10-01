// Uploads history/<stationId>/<year>.json.gz to /api/history-put, then
// verifies long-range reads through the public /api/fts endpoint.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const SITE = process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("ADMIN_TOKEN missing"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { uploads: {}, verify: {} };
for (const sid of readdirSync("history").sort()) {
  for (const f of readdirSync(`history/${sid}`).sort()) {
    const year = Number(f.slice(0, 4));
    const observations = JSON.parse(gunzipSync(readFileSync(`history/${sid}/${f}`)));
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${SITE}/api/history-put`, { method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": TOKEN },
        body: JSON.stringify({ stationId: sid, year, source: "FTS Power BI + station tables + hot archive (QC'd)", observations }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.mode === "history-put") { (report.uploads[sid] ||= {})[year] = out.written; break; }
      console.log(sid, year, `attempt ${attempt}: HTTP ${res.status}`, JSON.stringify(out).slice(0, 200));
      if (attempt >= 30) throw new Error(`giving up on ${sid} ${year}`);
      await sleep(30000);
    }
  }
  console.log(sid, JSON.stringify(report.uploads[sid]));
}
await sleep(60000);
const longHours = Math.ceil((Date.now() - Date.UTC(2017, 0, 1, 7)) / 3600000);
for (const sid of Object.keys(report.uploads)) {
  const r = await fetch(`${SITE}/api/fts?station=${sid}&hours=${longHours}&nocache=${Date.now()}`);
  const obs = await r.json();
  const r3 = await fetch(`${SITE}/api/fts?station=${sid}&hours=26298&nocache=${Date.now()}`);
  const o3 = await r3.json();
  report.verify[sid] = { longStatus: r.status, longCount: obs.length, longFirst: obs[0]?.measurementDateTime,
    longRes: r.headers.get("x-archive-resolution-hours"), longBytes: JSON.stringify(obs).length,
    threeYearCount: o3.length, threeYearRes: r3.headers.get("x-archive-resolution-hours") };
  console.log(sid, JSON.stringify(report.verify[sid]));
}
writeFileSync("audit/history-report.json", JSON.stringify({ at: new Date().toISOString(), ...report }, null, 1));
