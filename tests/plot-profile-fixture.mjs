/* Synthetic Banff Snowpack site data in the layout written by snowagent.web.build. */
export {utcTime, currentSeason, summarisePlot, simTemps, hardnessLabel, pitIsCurrent, PAIR_PLOTS} from '../assets/plot-profile-data.js';
import {PAIR_PLOTS} from '../assets/plot-profile-data.js';
export const plotForPairIds = ids => PAIR_PLOTS[ids.join(',')] || null;

export const SITES = {sites: [
  {id: 'bow_summit', name: 'Bow Summit', lat: 51.70946, lon: -116.4795, elevation_m: 2040, seasons: [
    {season: '2025-2026', mode: 'live', file: 'data/bow_summit/2025-2026.json', pits: 6, live: null},
    {season: '2026-2027', mode: 'live', file: 'data/bow_summit/2026-2027.json', pits: 2, live: {generated_utc: '2026-10-07T12:53:54+00:00'}}
  ]},
  {id: 'simpson', name: 'Simpson', lat: 50.98516, lon: -115.9843, elevation_m: 2115, seasons: []},
  {id: 'goats_eye', name: "Sunshine Village - Goat's Eye", lat: 51.08953, lon: -115.75462, elevation_m: 2280, seasons: []}
]};

export const SEASON = {
  label: 'EXPERIMENTAL snowpack-structure prediction for expert decision support. Not an avalanche forecast, danger rating or operational guidance.',
  site: 'bow_summit', season: '2026-2027', mode: 'live',
  live: {generated_utc: '2026-10-07T12:53:54+00:00', weather_through: '2026-10-07T12:00:00+00:00'},
  nowcast: [
    {t: '2026-10-07T12', hs: 62.4, swe: 160, L: [
      [62.4, 55.1, 'PP', 1.0, 85, -7.9, 0, 0],
      [55.1, 41.0, 'DF', 1.8, 140, -5.2, 0, 0],
      [41.0, 38.5, 'MFcr', 4.6, 420, -3.1, 0, 1],
      [38.5, 0, 'FC', 2.3, 260, -1.0, 0, 2]
    ]},
    {t: '2026-10-07T06', hs: 60, swe: 150, L: [[60, 0, 'RG', 3, 300, -2, 0, 0]]}
  ],
  pits: [
    {id: 'pit-1', t: '2026-09-28T18:00', hs: 30, L: [[30, 0, 'RG', 3, null]], tests: [], temps: [], source: 'exact'},
    {id: 'pit-2', t: '2026-10-05T18:30', hs: 66, L: [
      [66, 58, 'PP', 1, null], [58, 44, 'DF', 2, 150], [44, 41, 'MFcr', 5, null], [41, 0, 'FCxr', 2.5, 280]
    ], tests: [{type: 'CT', result: 'CT14', score: 14, fracture_character: 'SP', height_cm: 40}],
    temps: [[66, -9], [50, -6], [30, -3], [10, -1], [0, 0]], source: 'transcribed',
    nowcast: {t: '2026-10-06T00', hs_diff_cm: -4, grain_class_agreement: 0.62, hardness_mae_index: 0.8, hardness_bias_index: -0.2, boundary_f1: 0.5}}
  ]
};
