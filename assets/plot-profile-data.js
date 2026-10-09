/* Study-plot snow profiles from the Banff Snowpack site (https://banff-snowpack.netlify.app).
   Pure helpers shared by the /api/plot-profile function and the paired-pane profile panel.

   That site publishes, per study plot and season, data/<plot>/<season>.json with
     nowcast: simulated SNOWPACK profiles every 6 h, {t, hs, swe, L}, where each L row is
              [top_cm, bottom_cm, grain_form, hardness_index, density, temp_c, lwc_pct, flags]
              (flags bit 1 = melt-freeze crust, bit 2 = candidate weak layer)
     pits:    observed profiles, {id, t, hs, L, tests, temps, source, nowcast}, where each L row is
              [top_cm, bottom_cm, grain_form, hardness_index, density] and temps is [[height_cm, temp_c]]
   Heights are above ground; times are UTC "YYYY-MM-DDTHH" (nowcast) or "YYYY-MM-DDTHH:MM" (pits).
   Hand hardness index: F=1, 4F=2, 1F=3, P=4, K=5, I=6 (fractional = in between). */

export const SNOWPACK_SITE = 'https://banff-snowpack.netlify.app';
/* The three plots the Banff Snowpack site runs. */
export const PLOTS = {
  bow_summit: 'Bow Summit',
  simpson: 'Simpson',
  goats_eye: "Goat's Eye"
};
/* Paired panes whose stations sit at or beside a study plot. Pairs not listed get no profile
   rather than a distant plot. */
export const PAIR_PLOTS = {
  'fts-vulture,fts-bowsummit': 'bow_summit',
  'fts-simpup,fts-simplo': 'simpson',
  'fts-lookout,fts-sunshine': 'goats_eye'
};
/* An observed pit older than this is reported but not drawn. */
export const PIT_MAX_AGE_DAYS = 14;
export const HARDNESS = ['', 'F', '4F', '1F', 'P', 'K', 'I'];
const DAY = 86400000;

/* "2026-10-07T12" or "2026-10-07T12:30" (UTC) -> epoch ms; null if unreadable. */
export function utcTime(t) {
  if (typeof t !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(?::(\d{2}))?/.exec(t);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3] || '00'}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/* sites.json -> {site, season} for the plot: the live season if there is one, else the newest. */
export function currentSeason(sites, plot) {
  const site = (sites?.sites || []).find(s => s.id === plot);
  if (!site || !Array.isArray(site.seasons) || !site.seasons.length) return null;
  const sorted = [...site.seasons].sort((a, b) => String(a.season).localeCompare(String(b.season)));
  const season = sorted.filter(s => s.live).at(-1) || sorted.at(-1);
  return season?.file ? {site, season} : null;
}

function latestBy(items, key) {
  let best = null, bestT = -Infinity;
  for (const item of items || []) {
    const t = utcTime(item?.[key]);
    if (t !== null && t >= bestT) { best = item; bestT = t; }
  }
  return best;
}
const rows = L => (Array.isArray(L) ? L : []).filter(r => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]));

/* One plot-season file -> the compact record the pane draws: the latest simulated profile and the
   latest observed pit (with its agreement score against the simulation, when the site computed one). */
export function summarisePlot(plot, siteMeta, data) {
  const sim = latestBy(data?.nowcast, 't');
  const pit = latestBy(data?.pits, 't');
  return {
    plot,
    name: siteMeta?.name || PLOTS[plot] || plot,
    lat: siteMeta?.lat ?? null, lon: siteMeta?.lon ?? null, elevation: siteMeta?.elevation_m ?? siteMeta?.elevation ?? null,
    season: data?.season ?? null,
    mode: data?.mode ?? null,
    label: data?.label ?? null,
    live: data?.live ? {generated: data.live.generated_utc ?? null, weatherThrough: data.live.weather_through ?? null} : null,
    sim: sim ? {t: utcTime(sim.t), hs: sim.hs ?? null, layers: rows(sim.L).map(r => r.slice(0, 8))} : null,
    pit: pit ? {
      id: pit.id ?? null, t: utcTime(pit.t), hs: pit.hs ?? null, source: pit.source ?? null,
      layers: rows(pit.L).map(r => r.slice(0, 5)),
      tests: (pit.tests || []).filter(x => x && Number.isFinite(x.height_cm)),
      temps: (pit.temps || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])),
      score: pit.nowcast && 'boundary_f1' in pit.nowcast ? {
        hsDiff: pit.nowcast.hs_diff_cm ?? null, grainAgreement: pit.nowcast.grain_class_agreement ?? null,
        hardnessMae: pit.nowcast.hardness_mae_index ?? null
      } : null
    } : null,
    url: `${SNOWPACK_SITE}/?site=${encodeURIComponent(plot)}`
  };
}

/* Simulated layer temperatures as a [height_cm, temp_c] trace: one point per layer mid-height. */
export function simTemps(layers) {
  return rows(layers).filter(r => Number.isFinite(r[5])).map(r => [(r[0] + r[1]) / 2, r[5]]);
}
export function hardnessLabel(h) {
  if (!Number.isFinite(h)) return '–';
  const lo = Math.floor(h), hi = Math.ceil(h);
  if (lo === hi || h - lo < 0.25) return HARDNESS[Math.max(1, Math.min(6, lo))];
  if (hi - h < 0.25) return HARDNESS[Math.max(1, Math.min(6, hi))];
  return `${HARDNESS[Math.max(1, lo)]}-${HARDNESS[Math.min(6, hi)]}`;
}
export function ageDays(t, now = Date.now()) { return t === null || t === undefined ? null : (now - t) / DAY; }
export function pitIsCurrent(pit, now = Date.now()) {
  const age = ageDays(pit?.t, now);
  return age !== null && age >= -1 && age <= PIT_MAX_AGE_DAYS;
}
