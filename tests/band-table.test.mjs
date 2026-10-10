import test from 'node:test';
import assert from 'node:assert/strict';
import {bandRows, bandTableMarkdown} from '../netlify/functions/_ai-summary.mjs';

const stations = [
  {elevation_band: 'Alpine', temp_high_c: -1.2, temp_low_c: -9.6, precip_24h_mm: 4.2, wind_avg_kmh: 18, wind_dir_deg: 240, wind_peak_gust_kmh: 71},
  {elevation_band: 'Alpine', temp_high_c: 0.4, temp_low_c: -8, precip_24h_mm: null, wind_avg_kmh: 12, wind_dir_deg: 260, wind_peak_gust_kmh: 55},
  {elevation_band: 'Treeline', temp_high_c: 2, temp_low_c: -5, precip_24h_mm: null, wind_avg_kmh: 8, wind_dir_deg: 200, wind_peak_gust_kmh: 30},
  {elevation_band: 'Below treeline', status: 'no-observation'}
];

test('one row per band with data: extremes, wettest gauge, mean wind and direction', () => {
  const rows = bandRows(stations);
  assert.deepEqual(rows.map(r => r.band), ['Alpine', 'Treeline']);
  assert.equal(rows[0].high_c, 0.4);
  assert.equal(rows[0].low_c, -9.6);
  assert.equal(rows[0].hw24_max_mm, 4.2);
  assert.equal(rows[0].wind_avg_kmh, 15);
  assert.equal(rows[0].wind_dir, 'W');
  assert.equal(rows[0].gust_kmh, 71);
});

test('markdown table, dash where a band has no gauge', () => {
  assert.equal(bandTableMarkdown(bandRows(stations)), [
    '| Band | High / Low | Max HW 24h | Avg wind | Peak gust |',
    '|---|---|---|---|---|',
    '| Alpine (≥2200 m) | **0 °C** / **-10 °C** | **4.2 mm** | **15 km/h** W | **71 km/h** |',
    '| Treeline (1800–2200 m) | **2 °C** / **-5 °C** | – | **8 km/h** S | **30 km/h** |'
  ].join('\n'));
});
