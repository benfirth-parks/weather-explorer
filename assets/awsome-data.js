/* SnowpackBC AWSOME model (https://snowpackbc.com/#/modelling/awsome): today's stability snapshot for the
   paired panes. Pure helpers shared by /api/awsome and the panel in assets/awsome-panel.js.

   The source is a static site without CORS headers, so /api/awsome reads it server side:
     dcfg/operational.json                         -> {date: "YYYY-MM-DDTHH:00:00"} = the current model time
     <source>/geojson/<YYYY-MM-DD_HH-00-00>.<A>.json  for A in F (flat) and N, E, S, W (38 deg slopes);
        features[].properties.location, .snowpack.hs, .snowpack.Punstable {value, depth (cm below surface),
        grainType, instabilityDrivenBy}, .weather {hn24, ta, dw24_sector}
     nivix/xs?file=/opt/awsome/<source>/xsnowpack.zarr&location=..&inclination=0&azimuth=0&params=..
        -> {time: [unix s], hs: [cm], tops: [[layer top heights, cm above ground, bottom up]],
            params: {grainshape, hardness (F=1 .. I=6), temperature (C), punstable, layer_of_interest (0|1): [[...]]}}
   Punstable is the probability that a layer is unstable (Mayer et al. 2022); 0.77 is the usual threshold. */

export const AWSOME_SITE = 'https://snowpackbc.com';
export const ASPECTS = ['F', 'N', 'E', 'S', 'W'];
export const PUNSTABLE_THRESHOLD = 0.77;
/* Study plot (as in PAIR_PLOTS) -> AWSOME location. Simpson and Sunshine are not AWSOME stations, so they
   use a Banff grid cell (2.5 km): the one nearest the station with the closest elevation. */
export const AWSOME_POINTS = {
  bow_summit: {source: 'banff_stn', location: 'Bow_Summit', label: 'Bow Summit station run', elevation: 2040},
  simpson: {source: 'banff_grid', location: 'B_0002_0016', label: 'grid cell 1.5 km W of Simpson Lower', elevation: 1930},
  goats_eye: {source: 'banff_grid', location: 'B_0006_0022', label: 'grid cell 1 km W of Sunshine Village', elevation: 2311}
};

/* "2026-11-19T06:00:00" -> "2026-11-19_06-00-00" (the snapshot file stamp); null if unreadable. */
export function stamp(date) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(String(date || ''));
  return m ? `${m[1]}_${m[2]}-${m[3]}-${m[4]}` : null;
}
const num = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/* One aspect file -> {pu, depth, grain, tag} for the location, or null. */
export function aspectSummary(geojson, location) {
  const f = (geojson?.features || []).find(x => x?.properties?.location === location);
  const p = f?.properties?.snowpack?.Punstable;
  if (!p || !Number.isFinite(p.value)) return null;
  return {pu: num(p.value), depth: num(p.depth), grain: p.grainType || null, tag: p.instabilityDrivenBy || null};
}
export function weatherSummary(geojson, location) {
  const f = (geojson?.features || []).find(x => x?.properties?.location === location);
  const s = f?.properties?.snowpack, w = f?.properties?.weather;
  if (!s) return null;
  return {hs: num(s.hs), hn24: num(w?.hn24 ?? s.hn24), ta: num(w?.ta), wind: w?.dw24_sector || null};
}

/* nivix season record -> the flat-field profile at model time t (unix s): layers bottom up as
   [top_cm, bottom_cm, grain, punstable|null, weak 0|1, hardness|null, temp_c|null]. */
export function profileAt(xs, t) {
  const times = xs?.time || [];
  let i = -1;
  for (let k = 0; k < times.length; k++) if (times[k] <= t) i = k;
  if (i < 0) return null;
  const P = xs.params || {}, at = k => P[k]?.[i] || [];
  const tops = xs.tops?.[i] || [], g = at('grainshape'), pu = at('punstable'), wl = at('layer_of_interest'), hd = at('hardness'), tc = at('temperature');
  let bottom = 0;
  const layers = tops.map((top, j) => {
    const row = [num(top), num(bottom), g[j] || null, Number.isFinite(pu[j]) ? num(pu[j]) : null, wl[j] ? 1 : 0, num(hd[j]), num(tc[j])];
    bottom = top;
    return row;
  });
  return {t: times[i] * 1000, hs: num(xs.hs?.[i] ?? tops.at(-1) ?? 0), layers};
}

/* Everything the panel draws, from the five aspect files and the profile. */
export function summariseAwsome(plot, date, files, xs) {
  const point = AWSOME_POINTS[plot];
  const aspects = {};
  for (const a of ASPECTS) aspects[a] = aspectSummary(files[a], point.location);
  const t = Date.parse(`${String(date).slice(0, 19)}Z`);
  return {
    plot, ...point, t,
    weather: weatherSummary(files.F, point.location),
    aspects,
    profile: xs ? profileAt(xs, t / 1000) : null,
    url: `${AWSOME_SITE}/#/modelling/awsome`,
    label: 'Experimental SnowpackBC AWSOME model output, not an avalanche forecast.'
  };
}
