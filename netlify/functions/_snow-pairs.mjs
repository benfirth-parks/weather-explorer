/* HN, HST and HS for each station pair, appended to the AI 24h summary.
   Worked out here rather than by the model so the numbers are exact and
   always present. Uses the same rules as the dashboard's 24 h station summary
   table, so HN24, HST and HS agree with it to within 0.5 cm (whole cm here,
   0.1 cm there). */

import { HOUR } from "../../assets/pair-comparison-data.js";
import { stormSnow, newSnow24h, HST_LOOKBACK_H } from "../../assets/hst.js";
import { SNOW_EXCLUDED_IDS, NO_SNOW_SENSOR_IDS, withoutFalseNewSnow } from "../../assets/snow-stations.js";

/* Mirrors STATION_PAIRS in index.html; `snow` is the pair's snow station
   (the upper stations' snow figures are hidden on the dashboard). */
export const SNOW_PAIRS = [
  { label: "Vulture Peak / Bow Summit",  snow: "fts-bowsummit", hn: true },
  { label: "Simpson Upper / Lower",      snow: "fts-simplo",    hn: true },
  { label: "Bosworth Upper / Lower",     snow: "fts-boslo",     hn: true },
  { label: "Lookout / Sunshine Village", snow: "fts-sunshine",  hn: true },
  { label: "Whymper / Stanley Lower",    snow: "fts-stanley",   hn: true }
];

/* Hours of archive needed: HST looks back as far as the 24 h table's HST (10 days). */
export const SNOW_PAIR_HOURS = HST_LOOKBACK_H + 6;
/* Whole centimetres, so each figure is within 0.5 cm of the dashboard's 24 h table. */
export function round1cm(cm) {
  return cm === null || cm === undefined ? null : Math.round(cm);
}

/* The dashboard's record cleanup and HS rules (sanitizeRecords, filterSnowSpikes and
   snowHeight24h in index.html), mirrored here so the summary reports the same HS as the
   24 h station summary table. Keep them in step. HN24 is newSnow24h in assets/hst.js. */
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const time = (r) => new Date(r.measurementDateTime).getTime();
export function sanitizeRecords(records) {
  let prevHs = null;
  return (records || []).map((r) => ({ ...r })).sort((a, b) => time(a) - time(b)).map((rec) => {
    let hs = num(rec.snowHeight);
    if (Number.isFinite(hs) && hs < 0 && hs >= -5) { hs = 0; rec.snowHeight = 0; }
    if (Number.isFinite(hs)) {
      if (hs < 0 || hs > 600 || (prevHs !== null && Math.abs(hs - prevHs) > 30)) rec.snowHeight = null;
      else prevHs = hs;
    } else rec.snowHeight = null;
    const hn = num(rec.newSnow);
    rec.newSnow = Number.isFinite(hn) && hn >= 0 && hn <= 50 ? hn : null;
    const hwi = num(rec.precipIncr);
    rec.precipIncr = Number.isFinite(hwi) && hwi >= 0 && hwi <= 50 ? hwi : null;
    const hwt = num(rec.precipTotal);
    rec.precipTotal = Number.isFinite(hwt) && hwt >= 0 && hwt <= 5000 ? hwt : null;
    return rec;
  });
}
function filterSnowSpikes(records) {
  const out = [];
  let prev = null;
  for (const d of records) {
    const v = d.snowHeight;
    if (v == null) { out.push(d); continue; }
    if (prev === null || Math.abs(v - prev) <= 30) { out.push(d); prev = v; }
  }
  return out;
}
function snowHeight24h(recs) {
  const depth = filterSnowSpikes(recs.filter((d) => Number.isFinite(num(d.snowHeight))));
  if (!depth.length) return null;
  const value = Number(depth.at(-1).snowHeight);
  return !Number.isFinite(value) || value < 0 || value > 600 ? null : value;
}

/* HN24, HST and HS for one station's records, ending at `now`, in whole cm.
   HN24 and HST: as the 24 h table (assets/hst.js): HN24 the sum of the hourly HN over the
   last 24 h, HST the HS change over the current storm (same 10-day lookback).
   HS: the latest spike-filtered depth. `id` applies the per-station rules in
   assets/snow-stations.js. */
export function snowFigures(records, now, { hn = true, id = null } = {}) {
  if (SNOW_EXCLUDED_IDS.has(id) || NO_SNOW_SENSOR_IDS.has(id)) return { hn24_cm: null, hst_cm: null, hs_cm: null };
  const clean = withoutFalseNewSnow(id, sanitizeRecords(records)).filter((r) => time(r) <= now);
  const last24 = clean.filter((r) => time(r) >= now - 24 * HOUR);
  let hn24 = null, hst = null;
  if (hn) {
    hn24 = newSnow24h(clean, now);
    hst = hn24 === null ? null : stormSnow(clean, now)?.hst ?? null;
  }
  const hs = snowHeight24h(last24);
  return { hn24_cm: round1cm(hn24), hst_cm: round1cm(hst), hs_cm: round1cm(hs) };
}

/* Markdown block appended under the AI text. */
export function snowPairsMarkdown(rows) {
  const v = (x) => (x === null || x === undefined ? "no data" : `**${x} cm**`);
  const lines = rows.map((r) =>
    r.hn
      ? `- ${r.label}: HN24 ${v(r.hn24_cm)} · HST ${v(r.hst_cm)} · HS ${v(r.hs_cm)}`
      : `- ${r.label}: HS ${v(r.hs_cm)} (no HN sensor)`
  );
  return `**Snow Amounts** (observed, nearest 1 cm)\n${lines.join("\n")}`;
}
