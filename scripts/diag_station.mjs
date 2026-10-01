// Read-only diagnosis of station freshness: compares what the archive serves
// with what FTS360 currently returns (via the token-gated /api/fts-inspect),
// then triggers one normal sync (same as the half-hourly ping) and records
// the per-station result. Writes audit/diag-station.json.
import { writeFileSync, mkdirSync } from "node:fs";
const SITE = process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app";
const TOKEN = process.env.ADMIN_TOKEN;
const IDS = ["fts-sunshine", "fts-bowprecip", "fts-pikarun", "fts-skoki", "fts-boslo"];
const out = { at: new Date().toISOString(), before: {}, inspect: {}, sync: null, after: {} };
async function served(id) {
  const r = await fetch(`${SITE}/api/fts?station=${id}&hours=6&nocache=${Date.now()}`);
  const j = await r.json().catch(() => null);
  return { status: r.status, lastSynced: r.headers.get("x-archive-last-synced"),
    selfHealed: r.headers.get("x-archive-self-healed"), n: Array.isArray(j) ? j.length : null,
    last: Array.isArray(j) ? j.at(-1) : j };
}
for (const id of IDS) out.before[id] = await served(id);
for (const id of IDS) {
  out.inspect[id] = {};
  for (const h of [1, 2, 3, 6, 30]) {
    const r = await fetch(`${SITE}/api/fts-inspect?station=${id}&hours=${h}`, { headers: { "x-archive-admin-token": TOKEN } });
    const j = await r.json().catch(() => ({}));
    out.inspect[id][h] = { status: r.status, lineCount: j.lineCount, headerIndex: j.headerIndex,
      dataRows: Number.isInteger(j.lineCount) && Number.isInteger(j.headerIndex) && j.headerIndex >= 0 ? j.lineCount - j.headerIndex - 1 : null,
      headers: h === 6 ? j.headers : undefined, preHeaderLines: h === 6 ? j.preHeaderLines : undefined,
      sampleRows: j.sampleRows, error: j.error, details: j.details };
  }
}
const s = await fetch(`${SITE}/api/fts-sync-manual`, { headers: { "x-admin-token": TOKEN } });
const sj = await s.json().catch(() => ({}));
out.sync = { status: s.status, durationMs: sj.durationMs, succeeded: sj.succeeded, failed: sj.failed,
  results: (sj.results || []).filter((r) => IDS.includes(r.stationId) || !r.ok) };
await new Promise((r) => setTimeout(r, 5000));
for (const id of IDS) out.after[id] = await served(id);
mkdirSync("audit", { recursive: true });
writeFileSync("audit/diag-station.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
