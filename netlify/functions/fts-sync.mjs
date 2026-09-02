import { schedule } from "@netlify/functions";
import { syncAllStations } from "./_weather-archive.mjs";

/* Scheduled at 15 minutes past every hour (see netlify.toml). Runs the
   same parallel fan-out sync as the token-gated /api/fts-sync-manual
   webhook so the scheduled and manual paths never diverge. */
async function syncArchive() {
  const summary = await syncAllStations();

  console.log(JSON.stringify(summary));

  if (!summary.succeeded) {
    /* If every station failed, throw so Netlify records the run as an
       error in the function logs (helps spot upstream FTS360 outages). */
    throw new Error("All station archive syncs failed");
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export default schedule("15 * * * *", syncArchive);
