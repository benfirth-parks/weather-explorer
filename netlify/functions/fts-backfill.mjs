import { STATIONS, syncStation } from "./_weather-archive.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          Allow: "POST",
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  const token = request.headers.get("x-archive-admin-token");

  if (
    !process.env.ARCHIVE_ADMIN_TOKEN ||
    token !== process.env.ARCHIVE_ADMIN_TOKEN
  ) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }

  try {
    const requestBody = await request.text();
    const body = requestBody ? JSON.parse(requestBody) : {};

    const stationIds = body.station
      ? [body.station]
      : Object.keys(STATIONS);

    const seedHours = Math.min(
      Math.max(Number(body.seedHours || 720), 24),
      720
    );

    const results = [];

    for (const stationId of stationIds) {
      if (!STATIONS[stationId]) {
        results.push({
          stationId,
          ok: false,
          error: "Unsupported station"
        });
        continue;
      }

      try {
        results.push({
          ok: true,
          ...(await syncStation(stationId, seedHours))
        });
      } catch (error) {
        console.error(`Backfill failed for ${stationId}`, error);

        results.push({
          stationId,
          ok: false,
          error: error.message
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "Backfill failed",
        details: error.message
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }
};
