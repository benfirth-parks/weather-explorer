/* Forecaster feedback on the modelled study-plot snowpack (POST /api/plot-feedback).

   POST  { plot, source, team_code, name, agreement, topics[], note, model_t, model_hs, pit_t }
         Saves one note to Netlify Blobs (plot-feedback-v1). Open to anyone (owner,
         2026-11-18: no team code); 20 notes an hour per client IP. If FEEDBACK_TEAM_CODE
         is ever set, posts must carry it.
   GET   ?since=YYYY-MM-DD  with header x-feedback-admin-token
         Lists saved notes, oldest first. Used by the Banff Snowpack daily update
         to copy notes into its private archive. Notes and names are internal and
         never shown on the public site.

   Environment:
     FEEDBACK_TEAM_CODE     optional            if set, posts must carry this code
     FEEDBACK_ADMIN_TOKEN   required for GET    token for the daily update
*/

import { getStore } from "@netlify/blobs";
import { STORE_NAME, validateFeedback, feedbackKey, sameSecret } from "./_plot-feedback.mjs";

const RATE_STORE = "plot-feedback-ratelimit-v1";
const RATE_LIMIT = 20;
const RATE_WINDOW = 60 * 60 * 1000;
const MAX_BODY = 8000;
const MAX_LIST = 5000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function clientIp(req) {
  /* Set by Netlify from the real connection. x-forwarded-for is supplied by
     the caller, so it must not be used to key the rate limit. */
  return req.headers.get("x-nf-client-connection-ip") || "unknown";
}

async function rateLimited(ip) {
  try {
    const store = getStore(RATE_STORE);
    const key = ip.replace(/[^0-9a-zA-Z.:_-]/g, "_");
    const now = Date.now();
    const raw = await store.get(key, { type: "json" }).catch(() => null);
    const recent = (Array.isArray(raw) ? raw : []).filter((ts) => now - ts < RATE_WINDOW);
    if (recent.length >= RATE_LIMIT) return true;
    recent.push(now);
    await store.setJSON(key, recent).catch(() => {});
    return false;
  } catch {
    return false;
  }
}

async function save(req) {
  const code = process.env.FEEDBACK_TEAM_CODE;
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Note is too long." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (code && !sameSecret(String(body?.team_code || "").trim(), code)) return json({ error: "That team code is not right." }, 401);
  if (await rateLimited(clientIp(req))) return json({ error: "Too many notes this hour. Try again later." }, 429);
  const checked = validateFeedback(body, Date.now());
  if (!checked.ok) return json({ error: checked.error }, 400);
  const key = feedbackKey(checked.record, Math.random().toString(36).slice(2, 8));
  await getStore({ name: STORE_NAME, consistency: "strong" }).setJSON(key, checked.record);
  return json({ saved: true, received_at: checked.record.received_at }, 201);
}

async function list(req) {
  const token = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!token) return json({ error: "Feedback admin token is not configured." }, 503);
  if (!sameSecret(req.headers.get("x-feedback-admin-token") || "", token)) return json({ error: "Unauthorized" }, 401);
  const since = new URL(req.url).searchParams.get("since") || "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : "0000-00-00";
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).filter((k) => k.slice(0, 10) >= from).sort().slice(0, MAX_LIST);
  const notes = [];
  for (const key of keys) {
    const record = await store.get(key, { type: "json" }).catch(() => null);
    if (record) notes.push({ key, ...record });
  }
  return json({ count: notes.length, truncated: keys.length === MAX_LIST, notes });
}

export default async (req) => {
  try {
    if (req.method === "POST") return await save(req);
    if (req.method === "GET") return await list(req);
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    return json({ error: "Feedback store unavailable." }, 502);
  }
};
