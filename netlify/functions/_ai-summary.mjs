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

/* Vector-mean wind bearing weighted by speed, from an array of
   observations. Returns { deg, compass } or { deg: null, compass: null }
   when there is not enough moving air to resolve a bearing. */
function vectorMeanWind(observations) {
  let vx = 0, vy = 0, wsum = 0;
  for (const o of observations) {
    const dir = num(o.windDirAvg);
    const spd = num(o.windSpeedAvg);
    if (dir === null || spd === null || spd <= 0) continue;
    const rad = (dir * Math.PI) / 180;
    vx += spd * Math.sin(rad);
    vy += spd * Math.cos(rad);
    wsum += spd;
  }
  if (wsum <= 0) return { deg: null, compass: null };
  let bearing = (Math.atan2(vx, vy) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;
  const sectors = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return { deg: Math.round(bearing), compass: sectors[Math.round(bearing / 22.5) % 16] };
}

/* Smallest angular difference between two bearings, in degrees (0–180).
   Handles the 0/360 wrap. Returns null if either input is null. */
function bearingDelta(a, b) {
  if (a === null || b === null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/* Round to 1 decimal, or return null. */
function round1(v) { return v === null ? null : Math.round(v * 10) / 10; }

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

  /* Vector-averaged wind direction for the whole window. */
  const windDir = vectorMeanWind(observations);

  /* ---- Temporal decomposition ----
     Split the window into an early half and a late half and compute the
     same aggregates on each so the LLM can describe how conditions
     evolved, not just where they ended up. Also expose an hour-of-day
     tag for the temperature high / low and a wind-direction shift
     between the two halves. */
  const midIdx = Math.floor(observations.length / 2);
  const earlyObs = observations.slice(0, midIdx);
  const lateObs  = observations.slice(midIdx);

  const earlyTemp = minMax(earlyObs.map((o) => num(o.airTempAvg)));
  const lateTemp  = minMax(lateObs.map((o) => num(o.airTempAvg)));
  const earlyWind = minMax(earlyObs.map((o) => num(o.windSpeedAvg))).max;
  const lateWind  = minMax(lateObs.map((o) => num(o.windSpeedAvg))).max;
  const earlyGust = minMax(earlyObs.map((o) => num(o.windSpeedGust))).max;
  const lateGust  = minMax(lateObs.map((o) => num(o.windSpeedGust))).max;

  const earlyWindDir = vectorMeanWind(earlyObs);
  const lateWindDir  = vectorMeanWind(lateObs);
  const windDirShiftDeg = bearingDelta(earlyWindDir.deg, lateWindDir.deg);

  /* Hour-of-day (0–23, local sensor time as recorded) for the observation
     containing the window's high and low temperatures. Lets the model say
     "peaked mid-afternoon" rather than just "peak was 22 °C". */
  function hourOfExtreme(observations, key, wantMax) {
    let idx = -1;
    let best = wantMax ? -Infinity : Infinity;
    for (let i = 0; i < observations.length; i += 1) {
      const v = num(observations[i][key]);
      if (v === null) continue;
      if ((wantMax && v > best) || (!wantMax && v < best)) { best = v; idx = i; }
    }
    if (idx < 0) return null;
    const ts = observations[idx].measurementDateTime;
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? d.getUTCHours() : null;
  }

  /* Precipitation split into first half vs second half of the window, so
     the model can say "most of it fell in the second half" when true. */
  function precipDelta(obs) {
    const start = obs.find((o) => num(o.precipTotal) !== null);
    const endVal = latest(obs, "precipTotal");
    if (!start || endVal === null) return null;
    const s = num(start.precipTotal);
    if (s === null) return null;
    return Math.max(0, endVal - s);
  }
  const earlyPrecip = precipDelta(earlyObs);
  const latePrecip  = precipDelta(lateObs);

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
    wind_dir_deg: windDir.deg,
    wind_dir_compass: windDir.compass,
    /* Temporal fields — lets the model describe change through the window. */
    temp_high_hour_utc: hourOfExtreme(observations, "airTempAvg", true),
    temp_low_hour_utc: hourOfExtreme(observations, "airTempAvg", false),
    trend: {
      temp_early_high_c: earlyTemp.max,
      temp_early_low_c:  earlyTemp.min,
      temp_late_high_c:  lateTemp.max,
      temp_late_low_c:   lateTemp.min,
      wind_early_peak_kmh: earlyWind,
      wind_late_peak_kmh:  lateWind,
      gust_early_peak_kmh: earlyGust,
      gust_late_peak_kmh:  lateGust,
      wind_dir_early_compass: earlyWindDir.compass,
      wind_dir_late_compass:  lateWindDir.compass,
      wind_dir_shift_deg: windDirShiftDeg,
      precip_early_mm: earlyPrecip !== null ? round1(earlyPrecip) : null,
      precip_late_mm:  latePrecip  !== null ? round1(latePrecip)  : null
    },
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
export const SYSTEM_PROMPT = `You are an operational weather analyst writing a briefing for a Canadian visitor-safety / avalanche team working in Banff National Park (including adjacent Yoho and Kootenay terrain). Audience is professional (visitor safety technicians, avalanche forecasters, fire crews). Write in a calm, factual, briefing-note tone — no filler, no marketing language, no exclamation points.

Rules:
- HARD LIMIT: 2–3 sentences total, roughly 60–80 words. Be terse. Every sentence must carry new information; no restating the same observation across bands. If a rule below would force a fourth sentence, drop the less operationally important content instead.
- Do NOT mention or imply the time window. Never write "24 hours", "24-hour", "past day", "today", "overnight", or any similar time reference. Report the observations as current conditions.
- Differentiate observations along TWO axes:
  1. ELEVATION BAND: "Alpine" (≥2200 m), "Treeline" (1800–2200 m), "Below treeline" (<1800 m). Use those exact terms.
  2. REGION: cardinal areas of the park — "northern", "southern", "eastern", "western" (or combinations like "northwestern", "southeastern"). Each station in the snapshot has an \`ns\` (North/South) and \`ew\` (East/West) field relative to Lake Louise. Use whichever axis shows the more meaningful contrast; if both matter, use both.
- Station names ARE allowed when they add operational value — typically to attribute an outlier, a data-quality flag, or a single-station anomaly (e.g. "Sunshine Village recorded the peak gust", "Lake Louise inversion"). Do not name a station just to report a routine reading that fits inside a band/region range. Use the station's \`name\` field verbatim.
- DO NOT mention operational groups, program names, or agencies. Never write "Visitor Safety", "Fire", "VS", "Banff Fire", or similar internal-group labels. Just describe the weather across the park.
- Identify the MOST notable unique circumstance ONLY if it is genuinely operationally significant: a real temperature inversion, a standout wind or precipitation outlier, or an obvious data-quality issue. One flag maximum, and only when the anomaly earns a sentence; otherwise omit.
- Do NOT invent numbers. Only cite aggregate values (ranges, means, peaks) derived from the provided JSON.
- When you cite ANY temperature (high, low, or latest), give it as a RANGE across the stations in that elevation band and region — e.g. "Alpine highs 6–11 °C", "Below-treeline lows -2 to 3 °C". Never cite a single-station temperature; if only one station covers a band/region, still phrase it as a range using the min and max of the available high/low or use "about X °C" only if the values are identical. The same rule applies to wind speed ("gusts 40–65 km/h") and precipitation ("3–9 mm") whenever multiple stations exist for that group.
- WIND IS MANDATORY: every summary MUST include at least one wind observation covering both STRENGTH (average wind or peak gust range in km/h) and DIRECTION (dominant compass bearing across the relevant band/region, e.g. "WSW", "southwest"). Use the \`wind_dir_compass\` field on each station; when several stations share a band/region, report the dominant sector, or a small span like "W to WNW" if they cluster across two adjacent sectors. Alpine wind direction is usually the most operationally important — lead with it when it differs from below-treeline flow. Keep the wind clause short — one strength range plus one direction is enough.
- Do NOT report wind direction if fewer than half the stations in a band/region have a \`wind_dir_compass\` value — say "wind direction not resolvable" instead of guessing.
- TEMPORAL EVOLUTION IS MANDATORY: the summary must convey how the weather CHANGED through the observation window, not just where it ended. This can be a dedicated sentence OR a short clause embedded in another sentence (e.g. "alpine gusts strengthened to 45–65 km/h SW", "below-treeline precipitation was front-loaded"). Use the per-station \`trend\` object plus \`temp_high_hour_utc\` / \`temp_low_hour_utc\`. Prefer plain-language change verbs: "warmed", "cooled", "backed to", "veered to", "strengthened", "eased", "tapered", "peaked mid-afternoon", "lows just before dawn". Times are UTC; translate to rough English descriptors ("morning", "afternoon", "evening") using Mountain Time (UTC-6 summer / UTC-7 winter). Do NOT print absolute clock times.
- Flag a wind SHIFT when \`wind_dir_shift_deg\` is at least 45° for a band/region — that's operationally meaningful (frontal passage, valley/mountain wind flip). Ignore shifts below 30° as noise.
- If a station shows a snow-depth or new-snow value that is physically inconsistent with its temperature reading (e.g. HS >20 cm with a 20°C+ high), flag the affected elevation band / region as having a probable stale sensor rather than reporting the value as real weather.
- The snapshot excludes Jasper stations. Do NOT mention Jasper.
- Round temperatures to whole °C, precipitation to 0.1 mm, wind to whole km/h.
- Return ONLY the summary prose. No headers, no bullet points, no preamble.`;
