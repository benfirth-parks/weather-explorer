/* GET /api/kc-radiation?hours=48 -> { configured, generated_at, hours, stations: { "kc-burstall": [...], "kc-rundle": [...] } }

   Read-only relay of K-Country shortwave radiation for kcountry-wx-actuals (Ben, 25 Nov 2026), so that site
   needs no NOAA LRGS login. This site's hourly sync already downloads Burstall Pass (C4000254) and East End of
   Rundle (ABC03668) with its other GOES stations (netlify/functions/_lrgs.mjs, "csvrows"); this returns only
   their hourly shortwave fields (swA, swB at Burstall; swIn at Rundle), nothing else and no credentials.
   `configured` says whether this site has its LRGS login. /api/* is outside the Parks access check. */

import { readArchive, selectHours } from "./_weather-archive.mjs";
import { KC_RADIATION_FIELDS } from "./_lrgs.mjs";

export const KC_RADIATION_STATIONS = ["kc-burstall", "kc-rundle"];
const MAX_HOURS = 24 * 31;

/** Archive records -> [{ measurementDateTime, swIn?, swA?, swB? }] with at least one shortwave field. */
export function radiationOnly(records) {
  const out = [];
  for (const r of records || []) {
    const rec = { measurementDateTime: r.measurementDateTime };
    let any = false;
    for (const f of KC_RADIATION_FIELDS) {
      if (typeof r[f] === "number" && Number.isFinite(r[f])) { rec[f] = r[f]; any = true; }
    }
    if (any) out.push(rec);
  }
  return out;
}

export async function kcRadiation(hours, read = readArchive, env = process.env) {
  const h = Math.min(Math.max(Number(hours) || 48, 1), MAX_HOURS);
  const stations = {};
  for (const id of KC_RADIATION_STATIONS) {
    try {
      stations[id] = radiationOnly(selectHours(await read(id), h));
    } catch (error) {
      console.warn(JSON.stringify({ event: "kc-radiation-read-failed", id, error: error?.message || String(error) }));
      stations[id] = [];
    }
  }
  return { configured: Boolean(env.LRGS_USER && env.LRGS_PASSWORD), generated_at: new Date().toISOString(), hours: h, stations };
}

export default async (request) => {
  const hours = new URL(request.url).searchParams.get("hours");
  return new Response(JSON.stringify(await kcRadiation(hours)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
};

export const config = { path: "/api/kc-radiation" };
