import { syncAllStations } from "./_weather-archive.mjs";

/* Token-gated webhook that runs the exact same station sync as the
   scheduled `fts-sync` function. Purpose is to give an external cron
   (GitHub Actions, Perplexity scheduled task, uptime monitor) a
   reliable way to force a sync when Netlify's built-in scheduler
   skips a run. Accepts GET (for simple curls) and POST.

   Auth: send header `x-admin-token: <ARCHIVE_ADMIN_TOKEN>` OR add
   `?token=<ARCHIVE_ADMIN_TOKEN>` as a query string. Both are checked
   with a constant-time compare so token-value length can't leak.

   Response is always JSON. On success, returns the same summary
   object as the scheduled function's log line so external monitors
   can alert on `failed > 0`. */

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          Allow: "GET, POST",
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  const expected = process.env.ARCHIVE_ADMIN_TOKEN;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "Server not configured (ARCHIVE_ADMIN_TOKEN missing)" }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  const url = new URL(request.url);
  const providedHeader = request.headers.get("x-admin-token") || "";
  const providedQuery = url.searchParams.get("token") || "";
  const provided = providedHeader || providedQuery;

  if (!safeEqual(provided, expected)) {
    /* Deliberately terse response - don't confirm token shape/length. */
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  try {
    const summary = await syncAllStations();

    /* Emit the same structured log line as the scheduled path so both
       runs are indexable together in Netlify's function logs. */
    console.log(JSON.stringify({ ...summary, source: "manual-webhook" }));

    /* HTTP 207 when any station failed so pingers can alert on non-2xx. */
    const status = summary.failed === 0 ? 200 : 207;

    return new Response(JSON.stringify(summary), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("fts-sync-manual failed", error);
    return new Response(
      JSON.stringify({ error: "Sync failed", details: error.message }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
