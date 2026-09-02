import {
  STATIONS,
  INITIAL_SEED_HOURS,
  readArchive,
  syncStation,
  selectHours
} from "./_weather-archive.mjs";

/* If the archive is stale by more than this many minutes, the read
   handler synchronously refreshes it before responding. Chosen so it
   doesn't fire between healthy hourly syncs (which land at :15) but
   does fire on the very next visit after any missed run. */
const STALE_AFTER_MINUTES = 90;

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          Allow: "GET",
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  try {
    const url = new URL(request.url);
    const stationId = url.searchParams.get("station");
    const requestedHours = Number(url.searchParams.get("hours") || 24);

    if (!stationId || !STATIONS[stationId]) {
      return new Response(
        JSON.stringify({ error: "Invalid station" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          }
        }
      );
    }

    let archive = await readArchive(stationId);
    let seeded = false;
    let refreshed = false;

    if (!archive.observations.length) {
      /* Empty archive - do the full initial seed. */
      await syncStation(stationId, INITIAL_SEED_HOURS);
      archive = await readArchive(stationId);
      seeded = true;
    } else {
      /* Non-empty archive - self-heal if too stale. This covers the
         case where Netlify's scheduled function skipped a run. */
      const lastSyncMs = new Date(archive.lastSyncedAt || 0).getTime();
      const staleMs = STALE_AFTER_MINUTES * 60 * 1000;
      if (Number.isFinite(lastSyncMs) && Date.now() - lastSyncMs > staleMs) {
        try {
          await syncStation(stationId);
          archive = await readArchive(stationId);
          refreshed = true;
        } catch (err) {
          /* Log but don't fail the read - serving slightly stale data
             is better than a 500. The header still reports the true
             lastSyncedAt so clients can flag freshness themselves. */
          console.warn(
            JSON.stringify({
              event: "fts-self-heal-failed",
              stationId,
              error: err.message
            })
          );
        }
      }
    }

    const observations = selectHours(archive, requestedHours);

    return new Response(JSON.stringify(observations), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        "X-Weather-Data-Source": "netlify-blobs-archive",
        "X-Archive-Last-Synced": archive.lastSyncedAt || "",
        "X-Archive-Seeded": String(seeded),
        "X-Archive-Self-Healed": String(refreshed)
      }
    });
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "Weather archive unavailable",
        details: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }
};
