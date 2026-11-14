/* Elevation bands, highest first: valley < 1800 m, treeline 1800–2320 m, alpine ≥ 2320 m
   (Ben, 2026-11-12). Shared by the AI summary (netlify/functions/_ai-summary.mjs) and the
   temperature inversion note (assets/inversion.js). The band chips (ELEV_BANDS) and
   hourlyBandColor in index.html and mobile.html draw the same lines; keep them in step. */
export const BANDS = ['Alpine', 'Treeline', 'Below treeline'];
export const BAND_RANGE = {Alpine: '≥2320 m', Treeline: '1800–2320 m', 'Below treeline': '<1800 m'};

export function elevationBand(elev) {
  if (elev < 1800) return 'Below treeline';
  if (elev < 2320) return 'Treeline';
  return 'Alpine';
}
