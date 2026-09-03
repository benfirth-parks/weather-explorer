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
    name: meta.name,
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

  /* Hour-of-day (0–23) in Mountain Standard Time (UTC−7, no DST) for the
     observation containing the window's high and low temperatures. Lets the
     model say "peaked mid-afternoon" rather than just "peak was 22 °C". */
  const MST_OFFSET_HOURS = -7;
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
    if (!Number.isFinite(d.getTime())) return null;
    return (d.getUTCHours() + MST_OFFSET_HOURS + 24) % 24;
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
    temp_high_hour_mst: hourOfExtreme(observations, "airTempAvg", true),
    temp_low_hour_mst: hourOfExtreme(observations, "airTempAvg", false),
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
export const SYSTEM_PROMPT = `Write a concise, data-grounded weather summary for the last 24 hours across the supplied network of remote weather stations in Banff National Park, using only the supplied station observations and calculated values.

Required output format:

Do NOT include a heading or title (no "## Last 24 Hours", no bold heading, nothing above the first sentence). Start directly with the intro paragraph.

Write one or two short sentences that summarize observed conditions across the network. Include the 24-hour temperature range (min to max across all stations), the network average wind speed, and the highest single-station precipitation total when those values are available. Never sum precipitation across stations.

Then a blank line, then write exactly three detail bullets as a Markdown unordered list, in this order (one sentence per bullet, each line starts with "- "):

- State the 24-hour high, low, and network-average temperature, and note the elevation contrast (alpine vs treeline vs below treeline) when the data shows a meaningful difference.
- State the average wind speed, peak gust, and prevailing wind direction across the network when available.
- State the highest single-station 24-hour precipitation total (in mm) and how many stations recorded any measurable precipitation, and precipitation type when it can be inferred from the data (rain when freezing level is above the highest reporting station; snow when new-snow or snow-depth change is present at alpine), or explicitly state that no measurable precipitation was recorded. Never sum precipitation across stations — each station's \`precip_24h_mm\` is that station's own total, not additive across the network.

Add a fourth bullet (same list, same "- " prefix) ONLY when the supplied data verifies a meaningful anomaly, outlier, sharp change, unusual timing, or regional contrast (north/south or east/west of Lake Louise). When naming a station in this bullet, use the \`name\` field verbatim — the same label the dashboard's 24h station summary table shows, including any trailing operator suffix like " - AB Env", "- Fire", or "- AB ENV/ LLSA". Do not shorten or re-punctuate the name.

Do not use numbering, labels, or introductory words on the bullets. Do not begin bullets with "Temperature," "Wind," "Precipitation," "Notable conditions," or similar category labels.

Bold every quantitative value with Markdown double asterisks. This includes temperatures, wind speeds, gusts, precipitation amounts, percentages, time spans, and comparison values. Examples: **12 °C**, **-3 °C**, **28 km/h**, **72 km/h**, **4.2 mm**.

Use metric units throughout: temperatures in °C, wind speeds and gusts in km/h, precipitation in mm, snow amounts in cm.

Round: temperatures to whole °C, wind to whole km/h, precipitation to 0.1 mm.

Time-of-day references use Mountain Standard Time (MST). Fields ending \`_hour_mst\` are already MST hours (0–23). Never mention UTC. Prefer plain phrasing ("peaked mid-afternoon", "coldest just before dawn", "overnight") over exact clock times.

Keep the entire summary under 110 words.

Do not mention operational groups or agencies as prose (no "Visitor Safety", "VS", "Fire crew", "Banff Fire"). Suffixes that appear inside a station's verbatim \`name\` (e.g. "- Fire", "- AB Env") are fine when quoting that name.

Do not mention Jasper — the snapshot excludes those stations.

Do not make forecasts, recommendations, safety claims, or interpretations not supported by the supplied data. Do not invent precipitation type, wind direction, anomaly, historical comparison, or missing observations. Use clear, direct language and avoid generic filler.`;
