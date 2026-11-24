/* Gauge spike filter (Ben, 23 Nov 2026). The Bow Summit precip gauge (fts-bowprecip) had read a flat 200.0 mm
   for a month when, at 12:15-12:45 MT on 23 Nov, it stepped 200.9, 205.0, 210.2 and fell back to exactly 200.0
   at 13:00. Precipitation does not leave a weighing gauge, so a total that climbs and then falls back to where
   it started within a short time was never precipitation (someone at the gauge, a glitch, wind on the bucket).
   The HW rules sum the rises and skip the drop as an emptying, so the blip read as 10.2 mm of HW and let the
   gauge check count a 1 cm depth jitter as HN.

   cleanGaugeSpikes holds precipTotal at the level before the rise for every reading in a rise that falls back to
   within SPIKE_RETURN_TOL_MM of that level within SPIKE_RETURN_H. It applies to every gauge. A real emptying drops
   far below the earlier level (more than SPIKE_EMPTY_MM), so a real rise followed by an emptying is kept.
   Records are returned in the same order; changed ones are copies, the rest are the same objects. */
export const SPIKE_RETURN_H = 2;
export const SPIKE_RETURN_TOL_MM = 0.2;
export const SPIKE_EMPTY_MM = 10;
const HOUR = 3600000;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const valid = v => { const n = num(v); return n !== null && n >= 0 && n <= 5000 ? n : null; };

export function cleanGaugeSpikes(records) {
  if (!Array.isArray(records) || records.length < 3) return records;
  // Gauge readings in time order, with their positions in `records`.
  const pts = [];
  records.forEach((r, i) => {
    const v = valid(r && r.precipTotal), t = r ? Date.parse(r.measurementDateTime) : NaN;
    if (v !== null && Number.isFinite(t)) pts.push({i, t, v});
  });
  if (pts.length < 3) return records;
  pts.sort((a, b) => a.t - b.t);
  const hold = new Map(); // record index -> level to hold
  let base = pts[0].v;
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k];
    // Steps of SPIKE_RETURN_TOL_MM or less (a slow gauge's 0.1 mm ticks) are taken as they are.
    if (p.v <= base + SPIKE_RETURN_TOL_MM) { base = p.v; continue; }
    // A rise: does the total fall back to `base` within SPIKE_RETURN_H, without an emptying?
    let back = -1;
    for (let j = k + 1; j < pts.length && pts[j].t - p.t <= SPIKE_RETURN_H * HOUR; j++) {
      if (pts[j].v < base - SPIKE_EMPTY_MM) break;
      if (pts[j].v <= base + SPIKE_RETURN_TOL_MM) { back = j; break; }
    }
    if (back < 0) { base = p.v; continue; }
    for (let j = k; j < back; j++) hold.set(pts[j].i, base);
    base = pts[back].v; // the reading that fell back is the next base
    k = back;
  }
  if (!hold.size) return records;
  return records.map((r, i) => (hold.has(i) ? {...r, precipTotal: hold.get(i)} : r));
}
