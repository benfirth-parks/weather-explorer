// Cleanout markers for one station pair, from the field Google Sheet (assets/cleanouts-data.js).
// GET /api/cleanouts?pair=fts-bosup,fts-boslo
// The sheet must be shared as "anyone with the link can view"; it is read server side as CSV.
import { SHEET_ID, PAIR_TABS, parseTabs, tabForPair, cleanoutsFromCsv } from "../../assets/cleanouts-data.js";

const MEMORY_MS = 5 * 60000;
const cache = new Map();
let tabCache = null;
const json = (status, body, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store"
  }
});
const SHEET = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

async function getText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // A private sheet answers with a Google sign-in page instead of the content.
  if (/accounts\.google\.com/.test(res.url)) throw new Error("sheet is not shared publicly");
  return res.text();
}
async function tabs() {
  if (tabCache && Date.now() - tabCache.at < 60 * MEMORY_MS) return tabCache.tabs;
  let list = [];
  try { list = parseTabs(await getText(`${SHEET}/htmlview`)); } catch { /* fall back to known gids */ }
  if (list.length) tabCache = { at: Date.now(), tabs: list };
  return list;
}

export default async (req) => {
  if (req.method !== "GET") return json(405, { error: "Method not allowed" });
  const params = new URL(req.url).searchParams;
  const pair = params.get("pair") || "";
  if (!Object.hasOwn(PAIR_TABS, pair)) return json(400, { error: "Unknown pair", pairs: Object.keys(PAIR_TABS) });
  const debug = params.has("debug");
  const hit = cache.get(pair);
  if (hit && !debug && Date.now() - hit.at < MEMORY_MS) return json(200, hit.body, 120);
  try {
    const list = await tabs();
    const tab = tabForPair(pair, list);
    if (!tab) return json(200, { pair, tab: null, markers: [] }, 300);
    const csv = await getText(`${SHEET}/export?format=csv&gid=${tab.gid}`);
    if (/^\s*<!doctype html|^\s*<html/i.test(csv)) throw new Error("sheet is not shared publicly");
    const { markers, columns } = cleanoutsFromCsv(csv);
    const body = { pair, tab: tab.name, markers, ...(debug ? { columns, tabs: list.map(t => t.name) } : {}) };
    cache.set(pair, { at: Date.now(), body });
    return json(200, body, 120);
  } catch (error) {
    console.warn(JSON.stringify({ event: "cleanout-sheet-failed", pair, error: String(error?.message || error) }));
    if (debug) return json(200, { pair, error: String(error?.message || error) });
    if (hit) return json(200, { ...hit.body, stale: true }, 60);
    return json(502, { error: "Cleanout sheet unavailable", detail: String(error?.message || error) });
  }
};
