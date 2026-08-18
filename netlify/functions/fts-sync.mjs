import { schedule } from "@netlify/functions";
import { STATIONS, syncStation } from "./_weather-archive.mjs";

async function syncArchive() {
  const results = [];

  for (const stationId of Object.keys(STATIONS)) {
    try {
      results.push({
        ok: true,
        ...(await syncStation(stationId))
      });
    } catch (error) {
      console.error(`Sync failed for ${stationId}`, error);

      results.push({
        stationId,
        ok: false,
        error: error.message
      });
    }
  }

  const succeeded = results.filter((result) => result.ok).length;

  console.log(
    JSON.stringify({
      event: "fts-archive-sync",
      succeeded,
      total: results.length,
      results
    })
  );

  if (!succeeded) {
    throw new Error("All station archive syncs failed");
  }

  return new Response(
    JSON.stringify({
      succeeded,
      total: results.length,
      results
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    }
  );
}

export default schedule("15 * * * *", syncArchive);
