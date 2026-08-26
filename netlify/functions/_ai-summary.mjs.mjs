/* Shared helpers for the AI 24h summary endpoint.
   Keeps STATIONS metadata (name, elevation, park, group) alongside the
   station IDs already declared in _weather-archive.mjs, and rolls each
   station's archive into a compact 24h snapshot the LLM can reason over
   without swallowing thousands of raw hourly rows. */

import { readArchive, syncStation, selectHours, STATIONS as STATION_IDS } from "./_weather-archive.mjs";

/* Station metadata mirrors the STATIONS_GROUP* arrays in index.html.
   Keep this file in sync when new stations are added.

   `ns` / `ew` = position relative to Lake Louise (51.428 N, -116.209 W)
   on the two axes that define the Bow Valley: north/south and east/west.
   Together they give the model region context without needing to
   name-drop individual stations. */
export const STATION_META = [
  // Group 1 · Banff VS
  { stationId: "fts-boslo",       name: "Bosworth Lower",                     elevation: 2210, park: "Yoho",     group: 1, ns: "North", ew: "West" },
  { stationId: "fts-bosup",       name: "Bosworth Upper",                     elevation: 2745, park: "Yoho",     group: 1, ns: "North", ew: "West" },
  { stationId: "fts-bowsummit",   name: "Bow Summit",                         elevation: 2040, park: "Banff",    group: 1, ns: "North", ew: "West" },
  { stationId: "fts-bowprecip",   name: "Bow Summit Precip Gauge - AB Env",   elevation: 2040, park: "Banff",    group: 1, ns: "North", ew: "West" },
  { stationId: "fts-lookout",     name: "Lookout",                            elevation: 2640, park: "Banff",    group: 1, ns: "South", ew: "East" },
  { stationId: "fts-simplo",      name: "Simpson Lower",                      elevation: 2115, park: "Kootenay", group: 1, ns: "South", ew: "East" },
  { stationId: "fts-simpup",      name: "Simpson Upper",                      elevation: 2320, park: "Kootenay", group: 1, ns: "South", ew: "East" },
  { stationId: "fts-stanley",     name: "Stanley Lower",                      elevation: 1930, park: "Kootenay", group: 1, ns: "South", ew: "East" },
  { stationId: "fts-sunshine",    name: "Sunshine Village - AB Env",          elevation: 2200, park: "Banff",    group: 1, ns: "South", ew: "East" },
  { stationId: "fts-vulture",     name: "Vulture Peak",                       elevation: 2930, park: "Banff",    group: 1, ns: "North", ew: "West" },
  { stationId: "fts-whymper",     name: "Whymper",                            elevation: 2600, park: "Kootenay", group: 1, ns: "South", ew: "East" },
  // Group 2 · Banff Fire
  { stationId: "fts-boulder",     name: "Boulder Creek - Fire",               elevation: 1650, park: "Kootenay", group: 2, ns: "South", ew: "West" },
  { stationId: "fts-pikarun",     name: "Pika Run - AB Env / LLSA",           elevation: 2200, park: "Banff",    group: 2, ns: "North", ew: "West" },
  { stationId: "fts-vermillion",  name: "Vermillion Crossing - Fire",         elevation: 1310, park: "Kootenay", group: 2, ns: "South", ew: "East" },
  { stationId: "fts-lakelouise",  name: "Lake Louise - Fire",                 elevation: 1730, park: "Banff",    group: 2, ns: "North", ew: "West" },
  { stationId: "fts-castle",      name: "Castle - Fire",                      elevation: 1450, park: "Banff",    group: 2, ns: "South", ew: "East" },
  { stationId: "fts-skoki",       name: "Skoki - AB Env",                     elevation: 2160, park: "Banff",    group: 2, ns: "North", ew: "West" },
  // Group 3 · Jasper VS  (excluded from default summary scope)
  { stationId: "fts-tangleridge", name: "Tangle Ridge",                       elevation: 3009, park: "Jasper",   group: 3, ns: "North", ew: "West" },
  { stationId: "fts-coleman",     name: "Coleman Avalanche Control",          elevation: 2176, park: "Banff",    group: 3, ns: "North", ew: "West" },
  { stationId: "fts-bigbend",     name: "Big Bend",                           elevation: 2125, park: "Banff",    group: 3, ns: "North", ew: "West" },
  { stationId: "fts-maligne",     name: "Maligne",                            elevation: 1712, park: "Jasper",   group: 3, ns: "North", ew: "West" },
  { stationId: "fts-saskcrossing",name: "Saskatchewan Crossing",              elevation: 1392, park: "Banff",    group: 3, ns: "North", ew: "West" },
  // Group 4 · Jasper Fire  (excluded from default summary scope)
  { stationId: "fts-jasperqd1",   name: "Jasper QD1 'Green'",                 elevation: 1585, park: "Jasper",   group: 4, ns: "North", ew: "West" },
  { stationId: "fts-dorothy",     name: "Dorothy",                            elevation: 1528, park: "Jasper",   group: 4, ns: "North", ew: "West" },
  { stationId: "fts-devona",      name: "Devona",                             elevation: 1402, park: "Jasper",   group: 4, ns: "North", ew: "East" },
  { stationId: "fts-rangercreek", name: "Ranger Creek",                       elevation: 1289, park: "Jasper",   group: 4, ns: "North", ew: "West" }
];

const GROUP_LABELS = { 1: "Banff VS", 2: "Banff Fire", 3: "Jasper VS", 4: "Jasper Fire" };

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minMax(values) {
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!clean.length) return { min: null, max: null };
  return { min: Math.min(...clean), max: Math.max(...clean) };
}

function latest(observations, key) {
  for (let i = observations.length - 1; i >= 0; i -= 1) {
    const value = num(observations[i][key]);
    if (value !== null) return value;
  }
  return null;
}

/* Elevation band mirrors the dashboard's own band filter:
   valley < 1800 m, treeline 1800–2200 m, alpine ≥ 2200 m. */
function elevationBand(elev) {
  if (elev < 1800) return "Below treeline";
  if (elev < 2200) return "Treeline";
  return "Alpine";
}

/* Roll a single station's 24h archive slice into a compact snapshot.
   `station_id` (opaque) replaces the station name in the LLM payload so
   the model has no proper noun to name-drop — it can only report by
   elevation band and N/S + E/W region. */
function summarizeStation(meta, observations, lastSyncedAt) {
  const base = {
    station_id: meta.stationId,
    elevation_m: meta.elevation,
    elevation_band: elevationBand(meta.elevation),
    ns: meta.ns,
    ew: meta.ew
  };

  if (!observations.length) {
    return { ...base, status: "no-observation", last_synced: lastSyncedAt };
  }

  const temps = observations.map((o) => num(o.airTempAvg));
  const gusts = observations.map((o) => num(o.windSpeedGust));
  const winds = observations.map((o) => num(o.windSpeedAvg));

  const tempRange = minMax(temps);
  const gustPeak = minMax(gusts).max;
  const windRange = minMax(winds);

  const precipStart = observations.find((o) => num(o.precipTotal) !== null);
  const precipEndVal = latest(observations, "precipTotal");
  const precip24h = (precipStart !== undefined && precipEndVal !== null && num(precipStart?.precipTotal) !== null)
    ? Math.max(0, precipEndVal - num(precipStart.precipTotal))
    : null;

  const snowStart = observations.find((o) => num(o.snowHeight) !== null);
  const snowEndVal = latest(observations, "snowHeight");
  const snowDelta = (snowStart && snowEndVal !== null)
    ? snowEndVal - num(snowStart.snowHeight)
    : null;

  return {
    ...base,
    temp_high_c: tempRange.max,
    temp_low_c: tempRange.min,
    temp_latest_c: latest(observations, "airTempAvg"),
    precip_24h_mm: precip24h !== null ? Math.round(precip24h * 10) / 10 : null,
    new_snow_hn24_cm: latest(observations, "newSnow"),
    snow_depth_hs_cm: snowEndVal,
    snow_depth_change_24h_cm: snowDelta !== null ? Math.round(snowDelta * 10) / 10 : null,
    wind_avg_kmh: windRange.max !== null ? Math.round((windRange.min + windRange.max) / 2 * 10) / 10 : null,
    wind_peak_gust_kmh: gustPeak,
    humidity_latest_pct: latest(observations, "relativeHumidity"),
    observation_count: observations.length,
    last_observation: observations[observations.length - 1]?.measurementDateTime,
    last_synced: lastSyncedAt
  };
}

/* Operational groups included in the summary. Defaults to Groups 1 & 2
   (Banff VS + Banff Fire) to match how the dashboard's group chips are
   set on load. Override via the `groups` option, e.g.
   buildSnapshot({ groups: [3, 4] }) for a Jasper-only summary, or
   buildSnapshot({ groups: [1, 2, 3, 4] }) for everything. */
export const DEFAULT_GROUPS = [1, 2];

/* Build the snapshot for stations in the selected groups, in parallel.
   Stations with an empty archive are auto-seeded (same behaviour as
   fts.mjs) so a first-ever call still returns something useful. */
export async function buildSnapshot({ hours = 24, groups = DEFAULT_GROUPS } = {}) {
  const groupSet = new Set(groups);
  const included = STATION_META.filter((meta) => groupSet.has(meta.group));
  const results = await Promise.all(included.map(async (meta) => {
    if (!STATION_IDS[meta.stationId]) {
      return { ...meta, status: "unknown-station" };
    }
    try {
      let archive = await readArchive(meta.stationId);
      if (!archive.observations.length) {
        await syncStation(meta.stationId);
        archive = await readArchive(meta.stationId);
      }
      const observations = selectHours(archive, hours);
      return summarizeStation(meta, observations, archive.lastSyncedAt);
    } catch (error) {
      return { station: meta.name, park: meta.park, elevation_m: meta.elevation, status: "error", error: error.message };
    }
  }));

  return {
    generated_at: new Date().toISOString(),
    window_hours: hours,
    groups_included: groups,
    group_labels_included: groups.map((g) => GROUP_LABELS[g]).filter(Boolean),
    station_count: results.length,
    stations: results
  };
}

/* Prompt sent to Claude Haiku. Kept in one place so it can be tuned
   without touching the caller. */
export const SYSTEM_PROMPT = `You are an operational weather analyst writing a 24-hour summary for a Canadian visitor-safety / avalanche team working in Banff National Park (including adjacent Yoho and Kootenay terrain). Audience is professional (visitor safety technicians, avalanche forecasters, fire crews). Write in a calm, factual, briefing-note tone — no filler, no marketing language, no exclamation points.

Rules:
- HARD LIMIT: 2–3 sentences total, roughly 90 words maximum. Be terse.
- Differentiate observations along TWO axes:
  1. ELEVATION BAND: "Alpine" (≥2200 m), "Treeline" (1800–2200 m), "Below treeline" (<1800 m). Use those exact terms.
  2. REGION: cardinal areas of the park — "northern", "southern", "eastern", "western" (or combinations like "northwestern", "southeastern"). Each station in the snapshot has an \`ns\` (North/South) and \`ew\` (East/West) field relative to Lake Louise. Use whichever axis shows the more meaningful contrast on a given day; if both matter, use both.
- DO NOT name individual stations. Never write a station name, station ID, or a proxy like "one alpine site". Refer only to elevation bands and regions.
- Identify the MOST notable unique circumstance: a real temperature inversion, a standout wind or precipitation outlier, or an obvious data-quality issue. One flag, not a list. When flagging, still refer to the elevation band and region rather than the station itself.
- Do NOT invent numbers. Only cite aggregate values (ranges, means, peaks) derived from the provided JSON.
- If a station shows a snow-depth or new-snow value that is physically inconsistent with its temperature reading (e.g. HS >20 cm with a 20°C+ high), flag the affected elevation band / region as having a probable stale sensor rather than reporting the value as real weather.
- The snapshot is scoped to the Banff Visitor Safety and Banff Fire operational groups. Jasper stations are excluded. Do NOT mention Jasper.
- Round temperatures to whole °C, precipitation to 0.1 mm, wind to whole km/h.
- Return ONLY the summary prose. No headers, no bullet points, no preamble.`;
