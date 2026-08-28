/* AI chat endpoint for the Rockies Weather Explorer top-bar chatbot.

   Grounded strictly in the station snapshot produced by _ai-summary.mjs.
   The model receives the same elevation-band / region / trend payload the
   AI summary sees, and is instructed to refuse questions it cannot answer
   from that snapshot alone. Web search is disabled.

   Rate limit: 10 questions per hour per client IP, tracked in Netlify
   Blobs (rockies-weather-ai-chat-ratelimit-v1). No login required.

   Environment:
     PPLX_API_KEY        required   Perplexity API key
     PPLX_CHAT_MODEL     optional   defaults to "sonar"
*/

import { getStore } from "@netlify/blobs";
import { buildSnapshot, DEFAULT_GROUPS } from "./_ai-summary.mjs";

const RATE_STORE  = "rockies-weather-ai-chat-ratelimit-v1";
const RATE_LIMIT  = 10;                  // requests per window
const RATE_WINDOW = 60 * 60 * 1000;      // 1 hour in ms

/* Bounded conversation history. Client can send prior turns; we clamp to
   the last N so a single long-lived tab can't push infinite context. */
const MAX_HISTORY_TURNS = 6;             // 3 user + 3 assistant, rolling
const MAX_MESSAGE_CHARS = 500;           // per-message input cap

const SYSTEM_PROMPT = `You are an operational weather chatbot for the Rockies Weather Explorer dashboard. Your role is to answer questions about current conditions across a network of remote weather stations in Banff National Park (including adjacent Yoho and Kootenay terrain).

You have access to a station snapshot in the user message (JSON) covering roughly the past 24 hours. Every reading in your answer must come from that snapshot. Do NOT invent readings, forecast future weather, cite external sources, or answer questions unrelated to this station data.

STRICT SCOPE:
- ONLY answer questions about the weather observations in the snapshot: temperatures, winds (speed, gusts, direction), precipitation, snow, humidity, inversions, trends over the observation window, or contrasts by elevation band or region.
- If asked about anything else \u2014 forecasts, avalanche danger, road conditions, trail conditions, wildlife, closures, gear, past events outside the snapshot window, or general questions unrelated to station observations \u2014 decline briefly: "I can only answer questions about the current station observations in this dashboard." Do NOT attempt a helpful pivot; a clean refusal is better than an ungrounded answer.
- If the snapshot lacks data to answer (e.g. the user asks about a station or region with only stale or missing observations), say so directly: "The snapshot does not have current data for that." Do NOT guess.

DIFFERENTIATION AXES:
- ELEVATION BAND: "Alpine" (\u22652200 m), "Treeline" (1800\u20132200 m), "Below treeline" (<1800 m). Use these exact terms.
- REGION: cardinal areas of the park based on each station's \`ns\` (North/South) and \`ew\` (East/West) field, relative to Lake Louise. Combine like "northwestern", "southeastern" as needed.

PRIVACY RULES:
- Do NOT name individual stations, station IDs, or use identifying proxies like "one alpine site". Refer only to elevation bands and regions.
- Do NOT mention operational groups, program names, or agencies (no "Visitor Safety", "Fire", "VS", "Banff Fire", or similar). Just describe the weather.
- Do NOT mention that Jasper is excluded, and do NOT mention Jasper.

QUANTITATIVE STYLE:
- Cite temperatures as a RANGE across the stations in the referenced band/region: "Alpine highs 6\u201311 \u00b0C". Same for wind speed and precipitation. Only use a single value if all stations report identical values.
- Wind mentions must cover both STRENGTH and DIRECTION when both are resolvable. Use the \`wind_dir_compass\` field; report a dominant sector or a small span like "W to WNW".
- If more than half the stations in a band/region lack a resolvable wind direction, say "wind direction not resolvable" rather than guess.
- If flagging temporal change, use plain verbs: warmed, cooled, backed, veered, strengthened, eased, tapered, peaked, front-loaded. Use the \`trend\` and \`temp_high_hour_utc\` / \`temp_low_hour_utc\` fields. Translate UTC hours into English time-of-day (\"morning\", \"afternoon\", etc.) using Mountain Time (UTC-6 summer / UTC-7 winter). Never print absolute clock times.

FORMAT:
- Keep answers to 1\u20134 sentences, ~100 words maximum. Be direct.
- Return plain prose only. No markdown, no bullet points, no headers, no preamble.`;

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-nf-client-connection-ip") || "unknown";
}

/* Check + update the per-IP rate window. Returns { allowed, remaining, resetAt }.
   Storage is best-effort; if Blobs is unreachable we let the request through
   (a failed store is not a good reason to block a legitimate user). */
async function checkRateLimit(ip) {
  try {
    const store = getStore(RATE_STORE);
    const key = ip.replace(/[^0-9a-zA-Z.:_-]/g, "_");
    const now = Date.now();
    const raw = await store.get(key, { type: "json" }).catch(() => null);
    let entries = Array.isArray(raw) ? raw : [];
    entries = entries.filter((ts) => now - ts < RATE_WINDOW);
    if (entries.length >= RATE_LIMIT) {
      const oldest = Math.min(...entries);
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(oldest + RATE_WINDOW).toISOString()
      };
    }
    entries.push(now);
    await store.setJSON(key, entries).catch(() => {});
    return {
      allowed: true,
      remaining: RATE_LIMIT - entries.length,
      resetAt: new Date(now + RATE_WINDOW).toISOString()
    };
  } catch {
    return { allowed: true, remaining: null, resetAt: null };
  }
}

/* Clamp and sanitize the client-supplied conversation history. Only allow
   role: 'user' | 'assistant', string content, bounded length. */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const clean = [];
  for (const msg of history) {
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : null;
    const content = typeof msg.content === "string" ? msg.content.slice(0, MAX_MESSAGE_CHARS) : null;
    if (!role || !content) continue;
    clean.push({ role, content });
  }
  return clean.slice(-MAX_HISTORY_TURNS);
}

export default async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. POST a JSON body with { question, history? }." }, 405);
  }

  const apiKey = process.env.PPLX_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Server not configured: PPLX_API_KEY missing." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) {
    return jsonResponse({ error: "Missing 'question' string." }, 400);
  }
  if (question.length > MAX_MESSAGE_CHARS) {
    return jsonResponse({ error: `Question too long (max ${MAX_MESSAGE_CHARS} characters).` }, 400);
  }

  const ip = clientIp(req);
  const rate = await checkRateLimit(ip);
  if (!rate.allowed) {
    return jsonResponse({
      error: `Rate limit reached (${RATE_LIMIT} questions per hour). Try again after ${rate.resetAt}.`,
      rate
    }, 429);
  }

  /* Build the same snapshot the AI summary uses. Groups default to Banff
     VS + Banff Fire; override via body.groups if a caller ever needs it. */
  const hours  = Number.isFinite(body?.hours) ? Math.max(1, Math.min(48, body.hours)) : 24;
  const groups = Array.isArray(body?.groups) && body.groups.length ? body.groups : DEFAULT_GROUPS;

  let snapshot;
  try {
    snapshot = await buildSnapshot({ hours, groups });
  } catch (err) {
    return jsonResponse({ error: `Snapshot build failed: ${err?.message || err}` }, 502);
  }

  const history = sanitizeHistory(body?.history);

  /* Compose the user turn. Snapshot goes in the SAME turn as the question
     so the model sees them together; prior turns are relayed verbatim. */
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content:
`Station snapshot (JSON, ${snapshot.stations?.length ?? 0} stations, window ${snapshot.window_hours}h):
${JSON.stringify(snapshot)}

User question: ${question}`
    }
  ];

  const model = process.env.PPLX_CHAT_MODEL || "sonar";

  let pplxRes;
  try {
    pplxRes = await fetch("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 240,
        temperature: 0.2,
        disable_search: true
      })
    });
  } catch (err) {
    return jsonResponse({ error: `Perplexity request failed: ${err?.message || err}` }, 502);
  }

  if (!pplxRes.ok) {
    const detail = await pplxRes.text().catch(() => "");
    return jsonResponse({
      error: `Perplexity API returned ${pplxRes.status}`,
      detail: detail.slice(0, 300)
    }, 502);
  }

  const data = await pplxRes.json().catch(() => null);
  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return jsonResponse({ error: "Empty response from model." }, 502);
  }

  return jsonResponse({
    answer,
    model,
    generated_at: new Date().toISOString(),
    rate: { remaining: rate.remaining, resetAt: rate.resetAt },
    usage: data?.usage ?? null
  });
};

export const config = {
  path: "/api/ai-chat"
};
