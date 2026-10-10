/* HN, HST and HS for each station pair, appended to the AI 24h summary.
   Worked out here rather than by the model so the numbers are exact and
   always present. Uses the same HN and HS rules as the pair panes
   (assets/pair-comparison-data.js): a new-snow sensor where there is one,
   otherwise HN derived from the HS trace. */

import { HOUR, hnIntervals, smoothedHs } from "../../assets/pair-comparison-data.js";
import { stormSnow } from "../../assets/hst.js";

/* Mirrors STATION_PAIRS in index.html; `snow` is the pair's snow station
   (the upper stations' snow figures are hidden on the dashboard). Sunshine's
   new-snow field is not usable as HN, so that pair reports HS only. */
export const SNOW_PAIRS = [
  { label: "Vulture Peak / Bow Summit",  snow: "fts-bowsummit", hn: true },
  { label: "Simpson Upper / Lower",      snow: "fts-simplo",    hn: true },
  { label: "Bosworth Upper / Lower",     snow: "fts-boslo",     hn: true },
  { label: "Lookout / Sunshine Village", snow: "fts-sunshine",  hn: false },
  { label: "Whymper / Stanley Lower",    snow: "fts-stanley",   hn: true }
];

/* Hours of archive needed: HST looks back up to 7 days. */
export const SNOW_PAIR_HOURS = 7 * 24 + 6;
const MAX_STORM_DAYS = 7;
/* Nearest 5 cm, as the meeting reports snow amounts. */
export function round5(cm) {
  return cm === null || cm === undefined ? null : Math.round(cm / 5) * 5;
}

/* HN24, HST and HS for one station's records, ending at `now`.
   HN24: new snow in the last 24 h.
   HST: storm snow as in the 24 h table (assets/hst.js): new snow back to the
   most recent 24 h with under 1 cm, over the last 7 days; 0 when the last 24 h were dry.
   HS: the latest 3 h-smoothed snow depth. */
export function snowFigures(records, now, { hn = true } = {}) {
  let hn24 = null, hst = null;
  if (hn) {
    const from = now - MAX_STORM_DAYS * 24 * HOUR;
    const hourly = hnIntervals(records, from, now, 1).points;
    const day = (k) => {
      const end = now - k * 24 * HOUR, start = end - 24 * HOUR;
      const inDay = hourly.filter((p) => p.start >= start && p.end <= end);
      if (!inDay.length || inDay.some((p) => p.y === null)) return null;
      return inDay.reduce((s, p) => s + p.y, 0);
    };
    hn24 = day(0);
    if (hn24 !== null) hst = stormSnow(records, now, { lookbackHours: MAX_STORM_DAYS * 24 })?.hst ?? null;
  }
  const hsTrace = smoothedHs(records).filter((p) => p.x <= now && p.x > now - 6 * HOUR);
  const hs = hsTrace.length ? hsTrace.at(-1).y : null;
  return { hn24_cm: round5(hn24), hst_cm: round5(hst), hs_cm: round5(hs) };
}

/* Markdown block appended under the AI text. */
export function snowPairsMarkdown(rows) {
  const v = (x) => (x === null || x === undefined ? "no data" : `**${x} cm**`);
  const lines = rows.map((r) =>
    r.hn
      ? `- ${r.label}: HN24 ${v(r.hn24_cm)} · HST ${v(r.hst_cm)} · HS ${v(r.hs_cm)}`
      : `- ${r.label}: HS ${v(r.hs_cm)} (no HN sensor)`
  );
  return `**Snow Amounts** (observed, nearest 5 cm)\n${lines.join("\n")}`;
}
