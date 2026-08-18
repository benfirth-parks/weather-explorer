import {
  STATIONS,
  INITIAL_SEED_HOURS,
  readArchive,
  syncStation,
  selectHours
} from "./_weather-archive.mjs";

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

    if (!archive.observations.length) {
      await syncStation(stationId, INITIAL_SEED_HOURS);
      archive = await readArchive(stationId);
      seeded = true;
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
        "X-Archive-Seeded": String(seeded)
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
