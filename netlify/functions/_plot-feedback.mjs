/* Forecaster feedback on the modelled study-plot snowpack: shared checks for
   netlify/functions/plot-feedback.mjs, kept free of Netlify imports so tests
   can load them.

   A note records what the forecaster saw (which model and run and, if one was
   shown, which pit) and the server's receive time. The Banff Snowpack lab
   uses the receive time to keep notes written after a pit out of the scoring
   of that pit, so the client's own clock is never trusted for it. */

export const STORE_NAME = "plot-feedback-v1";
export const AGREEMENT = ["agree", "partly", "disagree"];
/* Which model a note is about. */
export const SOURCES = ["banff-snowpack", "awsome", "byk"];
export const TOPICS = ["depth", "weak_layer", "crust", "surface", "wind", "temperature", "other"];
export const LIMITS = { note: 2000, name: 60, topics: TOPICS.length };
const PLOT_RE = /^[a-z0-9_-]{2,40}$/;

const isTime = (v) => Number.isFinite(v) && v > Date.UTC(2015, 0, 1) && v < Date.UTC(2100, 0, 1);
const text = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

/* Returns {ok: true, record} or {ok: false, error}. `now` is the server time in ms. */
export function validateFeedback(body, now) {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a JSON object." };
  const plot = typeof body.plot === "string" ? body.plot.trim() : "";
  if (!PLOT_RE.test(plot)) return { ok: false, error: "Unknown plot." };
  const agreement = AGREEMENT.includes(body.agreement) ? body.agreement : null;
  const topics = Array.isArray(body.topics) ? [...new Set(body.topics.filter((t) => TOPICS.includes(t)))] : [];
  const note = text(body.note, LIMITS.note);
  if (!agreement && !note) return { ok: false, error: "Pick agree, partly or disagree, or write a note." };
  const name = text(body.name, LIMITS.name);
  if (!name) return { ok: false, error: "Add your name or initials." };
  const modelT = isTime(body.model_t) ? body.model_t : null;
  const pitT = isTime(body.pit_t) ? body.pit_t : null;
  const record = {
    version: 1,
    received_at: new Date(now).toISOString(),
    plot,
    source: SOURCES.includes(body.source) ? body.source : "banff-snowpack",
    agreement,
    topics,
    note,
    name,
    model_run_t: modelT === null ? null : new Date(modelT).toISOString(),
    model_hs_cm: Number.isFinite(body.model_hs) ? Math.round(body.model_hs) : null,
    // Which Banff model the forecaster saw (since 2026-11-27): the main model's id, or "snowpack" for standard SNOWPACK.
    model_id: text(body.model_id, 80) || null,
    pit_shown_t: pitT === null ? null : new Date(pitT).toISOString()
  };
  return { ok: true, record };
}

/* Blob key: sortable by receive time, grouped by day. */
export function feedbackKey(record, rand) {
  return `${record.received_at.slice(0, 10)}/${record.received_at}-${record.plot}-${rand}`;
}

/* Equal-time string compare, so a wrong code takes as long as a right one. */
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
