// Posts qc/<stationId>.json.gz patches to /api/import-historical with
// mode=qc-patch. Each field changes only if it still holds the value the
// QC scan saw. Rules: scripts/archive_qc_rules.py; log: audit/qc-log.csv;
// pre-clean snapshot: backup-pre-qc/.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const SITE = process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app";
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) { console.error("ADMIN_TOKEN missing"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (m) => (m >= 13 && m <= 19) || (m >= 23 && m <= 28) || (m >= 53 && m <= 58);
const report = {};
for (const file of readdirSync("qc").filter((f) => f.endsWith(".json.gz")).sort()) {
  const stationId = file.replace(".json.gz", "");
  const patches = JSON.parse(gunzipSync(readFileSync(`qc/${file}`)));
  for (let attempt = 1; ; attempt++) {
    while (busy(new Date().getUTCMinutes())) await sleep(20000);
    const res = await fetch(`${SITE}/api/import-historical`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": TOKEN },
      body: JSON.stringify({ stationId, mode: "qc-patch", patches })
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.mode === "qc-patch") {
      report[stationId] = { patches: patches.length, applied: out.qcApplied, mismatch: out.qcMismatch, notFound: out.qcNotFound };
      console.log(stationId, JSON.stringify(report[stationId]));
      break;
    }
    console.log(stationId, `attempt ${attempt}: HTTP ${res.status}`, JSON.stringify(out).slice(0, 300));
    if (attempt >= 30) throw new Error(`giving up on ${stationId}`);
    await sleep(30000);
  }
  await sleep(2000);
}
writeFileSync("audit/qc-report.json", JSON.stringify({ at: new Date().toISOString(), report }, null, 1));
