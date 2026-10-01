// Posts fill/<stationId>.json.gz to /api/import-historical with
// mode=fill-fields (existing values win; only empty fields are filled).
// Avoids the live-sync minutes (:15 Netlify schedule, :25/:55 GitHub ping)
// because the live sync's write is not etag-guarded.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const SITE = process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("ADMIN_TOKEN missing"); process.exit(1); }
const CHUNK = 13000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (m) => (m >= 13 && m <= 19) || (m >= 23 && m <= 28) || (m >= 53 && m <= 58);
async function clearOfSync() { while (busy(new Date().getUTCMinutes())) await sleep(20000); }

const report = {};
for (const file of readdirSync("fill").filter((f) => f.endsWith(".json.gz")).sort()) {
  const stationId = file.replace(".json.gz", "");
  const rows = JSON.parse(gunzipSync(readFileSync(`fill/${file}`)));
  const tot = { rows: rows.length, newlyAdded: 0, recordsFilled: 0, fieldsFilled: 0, totalAfter: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const body = JSON.stringify({ stationId, mode: "fill-fields", observations: rows.slice(i, i + CHUNK) });
    for (let attempt = 1; ; attempt++) {
      await clearOfSync();
      const res = await fetch(`${SITE}/api/import-historical`, {
        method: "POST", headers: { "content-type": "application/json", "x-admin-token": TOKEN }, body
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.mode === "fill-fields") {
        for (const k of ["newlyAdded", "recordsFilled", "fieldsFilled"]) tot[k] += out[k] || 0;
        tot.totalAfter = out.totalAfter;
        console.log(stationId, `chunk ${i / CHUNK + 1}`, JSON.stringify(out));
        await sleep(3000);
        break;
      }
      console.log(stationId, `chunk ${i / CHUNK + 1} attempt ${attempt}: HTTP ${res.status}`, JSON.stringify(out).slice(0, 300));
      if (attempt >= 30) throw new Error(`giving up on ${stationId}`);
      await sleep(30000); // new function may still be deploying
    }
  }
  report[stationId] = tot;
}
writeFileSync("audit/fill-report.json", JSON.stringify({ at: new Date().toISOString(), report }, null, 1));
console.log(JSON.stringify(report, null, 1));
