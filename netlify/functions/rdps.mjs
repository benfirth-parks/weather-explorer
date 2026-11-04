/* GET /api/rdps?station=fts-sunshine -> {station, source, points: [{x: hour end (ms), y: mm}]}: the RDPS
   hourly precipitation forecast used as the HN back check (see _rdps.mjs). points is null when the station
   has no RDPS point or the forecast could not be fetched. */
import { fetchRdps, RDPS_POINTS } from "./_rdps.mjs";

export default async (request) => {
  const station = new URL(request.url).searchParams.get("station");
  if (!station || !RDPS_POINTS[station]) {
    return new Response(JSON.stringify({ error: "Invalid station" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });
  }
  const points = await fetchRdps(station);
  return new Response(JSON.stringify({ station, source: "RDPS (GEM Regional) via Open-Meteo", points }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": points ? "public, max-age=900" : "no-store" },
  });
};

export const config = { path: "/api/rdps" };
