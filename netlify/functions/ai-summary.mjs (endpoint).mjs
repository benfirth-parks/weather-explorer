/* GET /api/ai-summary
   Returns { summary, generated_at, cached, model, station_count }.

   Uses Netlify Blobs as a 30-minute cache so we don't hit the Perplexity API
   on every page load. Force a refresh with ?refresh=1.

   Env vars required:
     PPLX_API_KEY        - your Perplexity API key (from perplexity.ai/account/api)
     PPLX_MODEL          - (optional) defaults to "sonar"
     AI_SUMMARY_TTL_SEC  - (optional) cache TTL in seconds, defaults to 1800

   Uses the Perplexity Sonar chat completions endpoint (OpenAI-compatible
   shape). Web search is disabled because we already hand the model the full
   station snapshot — no retrieval needed. */

import { getStore } from "@netlify/blobs";
import { buildSnapshot, SYSTEM_PROMPT } from "./_ai-summary.mjs";

const CACHE_STORE = "rockies-weather-ai-summary-v1";
const CACHE_KEY = "latest.json";
const DEFAULT_TTL_SEC = 30 * 60;
const DEFAULT_MODEL = "sonar";
const PPLX_ENDPOINT = "https://api.perplexity.ai/v1/sonar";

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

async function readCache() {
  try {
    return await getStore(CACHE_STORE).get(CACHE_KEY, { type: "json" });
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  try {
    await getStore(CACHE_STORE).setJSON(CACHE_KEY, payload);
  } catch (error) {
    console.error("ai-summary cache write failed:", error.message);
  }
}

function isFresh(cached, ttlSec) {
  if (!cached?.generated_at) return false;
  const age = (Date.now() - new Date(cached.generated_at).getTime()) / 1000;
  return age < ttlSec;
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
  }

  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const ttlSec = Number(process.env.AI_SUMMARY_TTL_SEC || DEFAULT_TTL_SEC);

    if (!forceRefresh) {
      const cached = await readCache();
      if (isFresh(cached, ttlSec)) {
        return json({ ...cached, cached: true }, {
          status: 200,
          headers: {
            "Cache-Control": `public, max-age=60, s-maxage=${ttlSec}, stale-while-revalidate=600`,
            "X-AI-Summary-Cache": "hit"
          }
        });
      }
    }

    if (!process.env.PPLX_API_KEY) {
      return json({ error: "Missing PPLX_API_KEY env var" }, { status: 500 });
    }

    const snapshot = await buildSnapshot({ hours: 24 });
    const model = process.env.PPLX_MODEL || DEFAULT_MODEL;

    const userContent = `Summarize the last 24 hours of weather actuals across all stations below. Follow every rule in your system prompt.\n\nSnapshot JSON:\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``;

    const pplxResponse = await fetch(PPLX_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PPLX_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userContent }
        ],
        max_tokens: 250,
        temperature: 0.2,
        disable_search: true
      })
    });

    if (!pplxResponse.ok) {
      const errBody = await pplxResponse.text();
      console.error(`Perplexity API ${pplxResponse.status}:`, errBody);
      return json({
        error: "AI provider error",
        status: pplxResponse.status,
        details: errBody.slice(0, 500)
      }, { status: 502 });
    }

    const data = await pplxResponse.json();
    const summaryText = (data?.choices?.[0]?.message?.content || "").trim();

    if (!summaryText) {
      return json({ error: "Empty summary from model" }, { status: 502 });
    }

    const payload = {
      summary: summaryText,
      generated_at: new Date().toISOString(),
      window_hours: snapshot.window_hours,
      station_count: snapshot.station_count,
      model,
      usage: data?.usage,
      cached: false
    };

    await writeCache(payload);

    return json(payload, {
      status: 200,
      headers: {
        "Cache-Control": `public, max-age=60, s-maxage=${ttlSec}, stale-while-revalidate=600`,
        "X-AI-Summary-Cache": "miss"
      }
    });
  } catch (error) {
    console.error("ai-summary failed:", error);
    return json({ error: "AI summary unavailable", details: error.message }, { status: 500 });
  }
};
