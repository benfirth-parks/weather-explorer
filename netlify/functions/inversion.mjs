/* GET /api/inversion?groups=1,2 -> { note, inversion, groups, station_count, generated_at }.

   The temperature inversion warning shown at the top of the 24 h station summary: the same
   rule and wording as the note that leads the AI summary (assets/inversion.js), worked out
   from the last 24 h of every station in the region of the groups asked for. `note` is ""
   when there is no inversion. No AI call is made, so the page can ask on every load. */

import { STATION_META, regionGroups } from "./_ai-summary.mjs";
import { readArchive, selectHours } from "./_weather-archive.mjs";
import { inversionFromStations, inversionNoteMarkdown } from "../../assets/inversion.js";

const HOURS = 24;

/* `read` is injectable so the rule can be tested without the archive store. */
export async function inversionForGroups(asked, read = readArchive) {
  const groups = regionGroups(asked);
  const metas = STATION_META.filter((meta) => groups.includes(meta.group));
  const stations = await Promise.all(metas.map(async (meta) => {
    try {
      return { elevation: meta.elevation, observations: selectHours(await read(meta.stationId), HOURS) };
    } catch {
      return null; /* a station whose archive cannot be read is left out */
    }
  }));
  const inversion = inversionFromStations(stations.filter(Boolean), { hours: HOURS });
  return { note: inversionNoteMarkdown(inversion), inversion, groups, station_count: metas.length };
}

export default async (request) => {
  const asked = (new URL(request.url).searchParams.get("groups") || "")
    .split(",").filter((part) => part.trim() !== "").map(Number).filter(Number.isInteger);
  try {
    const body = await inversionForGroups(asked);
    return new Response(JSON.stringify({ ...body, generated_at: new Date().toISOString() }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120, s-maxage=300" }
    });
  } catch (error) {
    console.error("inversion failed:", error);
    return new Response(JSON.stringify({ error: "Inversion note unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }
};

export const config = { path: "/api/inversion" };
