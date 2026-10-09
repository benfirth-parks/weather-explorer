/* MOCK study-plot profiles for previewing the paired-pane profile panel before the season has snow.
   Loaded only with ?plotprofiles=mock. Same shape as /api/plot-profile; times are relative to now so
   the observed-pit age rules can be seen: Bow Summit has a recent pit, Goat's Eye a stale one,
   Simpson none. These are invented layers, not observations or model output. */
const H = 3600000, DAY = 24 * H;
const LABEL = 'MOCK DATA for previewing this panel: invented profiles, not observations or model output.';

export function mockPlotProfile(plot, now = Date.now()) {
  const simT = Math.floor((now - 2 * H) / (6 * H)) * 6 * H;
  const base = {season: '2026-2027', mode: 'mock', label: LABEL, live: null, mock: true};
  if (plot === 'bow_summit') return {...base, plot, name: 'Bow Summit', elevation: 2040, url: 'https://banff-snowpack.netlify.app/?site=bow_summit',
    sim: {t: simT, hs: 118, layers: [
      [118, 109, 'PP', 1.0, 80, -9.4, 0, 0],
      [109, 92, 'DF', 1.6, 130, -7.8, 0, 0],
      [92, 90.5, 'SH', 1.0, 200, -6.9, 0, 2],
      [90.5, 64, 'RG', 3.2, 280, -5.6, 0, 0],
      [64, 61, 'MFcr', 5.2, 440, -4.3, 0, 1],
      [61, 38, 'FC', 2.4, 270, -3.0, 0, 2],
      [38, 0, 'DH', 2.0, 300, -1.1, 0, 2]
    ]},
    pit: {id: 'mock-bow', t: now - 2 * DAY - 3 * H, hs: 112, source: 'exact',
      layers: [[112, 104, 'PP', 1, null], [104, 88, 'DF', 2, 140], [88, 87, 'SH', 1, null], [87, 60, 'RG', 3.5, 290],
        [60, 57, 'MFcr', 5, null], [57, 35, 'FC', 2, 260], [35, 0, 'DH', 2, 310]],
      tests: [{type: 'CT', result: 'CT13', score: 13, fracture_character: 'SP', height_cm: 87}, {type: 'ECT', result: 'ECTP18', score: 18, fracture_character: null, height_cm: 57}],
      temps: [[112, -11], [100, -9], [80, -7], [60, -5], [40, -3.5], [20, -2], [0, -0.5]],
      score: {hsDiff: 6, grainAgreement: 0.71, hardnessMae: 0.6}}};
  if (plot === 'simpson') return {...base, plot, name: 'Simpson', elevation: 2115, url: 'https://banff-snowpack.netlify.app/?site=simpson',
    sim: {t: simT, hs: 84, layers: [
      [84, 76, 'PP', 1.2, 90, -8.1, 0, 0],
      [76, 52, 'RG', 2.8, 240, -5.9, 0, 0],
      [52, 50, 'MFcr', 4.8, 420, -4.5, 0, 1],
      [50, 0, 'FC', 2.2, 250, -1.8, 0, 2]
    ]}, pit: null};
  if (plot === 'goats_eye') return {...base, plot, name: "Sunshine Village - Goat's Eye", elevation: 2280, url: 'https://banff-snowpack.netlify.app/?site=goats_eye',
    sim: {t: simT, hs: 146, layers: [
      [146, 131, 'PP', 1.0, 85, -10.2, 0, 0],
      [131, 98, 'DF', 2.0, 150, -8.0, 0, 0],
      [98, 60, 'RG', 3.8, 320, -5.2, 0, 0],
      [60, 57, 'MFcr', 5.5, 450, -3.9, 0, 1],
      [57, 0, 'FCxr', 3.0, 300, -1.4, 0, 0]
    ]},
    pit: {id: 'mock-ge', t: now - 20 * DAY, hs: 101, source: 'exact', layers: [[101, 0, 'RG', 3, 300]], tests: [], temps: [], score: null}};
  return null;
}
