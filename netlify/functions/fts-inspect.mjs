import { STATIONS, inspectStationHeaders } from "./_weather-archive.mjs";

/* Admin-only diagnostic endpoint.
   Returns the raw FTS360 CSV header row + up to 3 sample data rows for a
   given station. This lets us discover the exact column names a station
   publishes (which vary per hardware config) so we can teach the parser new
   aliases. It never writes to the archive and never dumps bulk data. */

export default async (request) => {
  const url = new URL(request.url);
  const stationId = url.searchParams.get("station");
  const hours = Math.min(Math.max(Number(url.searchParams.get("hours") || 48), 1), 720);

  const token = request.headers.get("x-archive-admin-token") || url.searchParams.get("token");

  if (
    !process.env.ARCHIVE_ADMIN_TOKEN ||
    token !== process.env.ARCHIVE_ADMIN_TOKEN
  ) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  if (!stationId) {
    return new Response(
      JSON.stringify({ error: "Missing 'station' query parameter", stations: Object.keys(STATIONS) }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  if (!STATIONS[stationId]) {
    return new Response(
      JSON.stringify({ error: `Unsupported station: ${stationId}`, stations: Object.keys(STATIONS) }),
      { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }

  try {
    const result = await inspectStationHeaders(stationId, hours);
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    console.error(`Inspect failed for ${stationId}`, error);
    return new Response(
      JSON.stringify({ error: "Inspect failed", details: error.message }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
