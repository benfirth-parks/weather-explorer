import { readState } from "./_site-health.mjs";

/* GET /api/site-health: the last hourly health check result. Read by the
   GitHub "Site watchdog" workflow. Holds no secrets. */
export default async () => {
  try {
    const state = await readState();
    return new Response(JSON.stringify(state), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
};
