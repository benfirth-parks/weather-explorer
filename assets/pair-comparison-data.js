// Pure comparison calculations. Never mutate the dashboard's observation cache.
export const HOUR = 3600000;
export const MAX_GAP = 1.5 * HOUR;
export function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function ordered(records) {
  const unique = new Map();
  for (const record of records || []) {
    const x = Date.parse(record.measurementDateTime);
    if (Number.isFinite(x)) unique.set(x, {...record, x});
  }
  return [...unique.values()].sort((a, b) => a.x - b.x);
}
function withGaps(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && point.x - last.x > MAX_GAP) result.push({x: last.x + 1, y: null});
    result.push(point);
  }
  return result;
}
export function metricSeries(records, metric, from, to) {
  const key = metric === 'temperature' ? 'airTempAvg' : 'windSpeedAvg';
  // Readings without this field are skipped (some loggers mix 15-min precip rows with hourly temps);
  // real gaps over 90 min are still broken by withGaps().
  const points = ordered(records).filter(r => r.x >= from && r.x <= to).map(r => {
    const value = numeric(r[key]);
    const point = {x: r.x, y: value !== null && (metric !== 'wind' || value >= 0) ? value : null};
    if (metric === 'wind') {
      const dir = numeric(r.windDirAvg);
      point.dir = dir !== null && dir >= 0 && dir <= 360 ? dir % 360 : null;
    }
    return point;
  }).filter(p => p.y !== null);
  return {points: withGaps(points), partial: false};
}
export function precipitationSeries(records, from, to) {
  const rows = ordered(records).filter(r => r.x <= to);
  function accumulate(field) {
    let total = 0, previous = null, partial = false, intervals = 0;
    const points = [];
    for (const row of rows) {
      const raw = numeric(row[field]);
      const value = raw !== null && raw >= 0 && raw <= (field === 'precipTotal' ? 5000 : 50) ? raw : null;
      if (row.x < from) {
        previous = value === null ? null : {x: row.x, value};
        continue;
      }
      let step = null;
      if (field === 'precipIncr') {
        if (previous && row.x - previous.x > MAX_GAP) partial = true;
        step = value;
      } else if (value !== null && previous && row.x - previous.x <= MAX_GAP && previous.x >= from) {
        step = value - previous.value;
        if (step < 0 || step > 50) step = null;
      } else if (value !== null && previous && row.x - previous.x <= MAX_GAP && row.x === from) {
        // A reading exactly at the window start establishes the common zero baseline.
        step = 0;
      }
      if (step !== null && step >= 0 && step <= 50) {
        total += step;
        intervals++;
        points.push({x: row.x, y: Math.round(total * 100) / 100});
      } else {
        partial = true;
        points.push({x: row.x, y: null});
      }
      previous = value === null ? null : {x: row.x, value};
    }
    // Match the dashboard's 24h plausibility ceiling, without applying it to 7/30d totals.
    if (to - from <= 24 * HOUR && total > 150) {
      return {points: points.map(p => ({...p, y: null})), partial: true, total: null, intervals: 0};
    }
    return {points: withGaps(points), partial, total: intervals ? total : null, intervals};
  }
  const totals = accumulate('precipTotal');
  const increments = accumulate('precipIncr');
  const useIncrements = !totals.intervals || (totals.total === 0 && increments.total > 0);
  const chosen = useIncrements ? increments : totals;
  return {...chosen, method: useIncrements ? 'reported intervals' : 'gauge changes'};
}
// One-to-one timestamp matching, not array-position matching or interpolation.
export function matchedDifference(first, second, tolerance = 30 * 60000) {
  const a = first.filter(p => p.y !== null), b = second.filter(p => p.y !== null);
  let j = 0, sum = 0, count = 0;
  for (const point of a) {
    while (j < b.length && b[j].x < point.x - tolerance) j++;
    if (j >= b.length) break;
    if (Math.abs(b[j].x - point.x) > tolerance) continue;
    while (j + 1 < b.length && Math.abs(b[j + 1].x - point.x) < Math.abs(b[j].x - point.x)) j++;
    sum += point.y - b[j].y;
    count++;
    j++;
  }
  return {count, difference: count ? sum / count : null};
}
// Change in HS since the window start (cm). Positive values are snow gain; settlement shows as a decline.
// Uses the dashboard's HS rules: 0–600 cm and no step over 30 cm from the last accepted reading.
export function hsChangeSeries(records, from, to) {
  const rows = ordered(records).filter(r => r.x <= to);
  let last = null, baseline = null, partial = false;
  const points = [];
  for (const row of rows) {
    const raw = numeric(row.snowHeight);
    let value = raw !== null && raw >= 0 && raw <= 600 ? raw : null;
    if (value !== null && last && Math.abs(value - last.value) > 30) value = null;
    if (row.x < from) {
      if (value !== null) last = {x: row.x, value};
      continue;
    }
    if (value === null) { partial = true; points.push({x: row.x, y: null}); continue; }
    if (baseline === null) {
      // Anchor to a reading just before the window if one exists within the gap tolerance.
      baseline = last && from - last.x <= MAX_GAP ? last.value : value;
    }
    points.push({x: row.x, y: Math.round((value - baseline) * 10) / 10});
    last = {x: row.x, value};
  }
  const valid = points.filter(p => p.y !== null);
  return {points: withGaps(points), partial, total: valid.length ? valid.at(-1).y : null, method: 'HS change'};
}
// ---- Rolling 24-hour values (the dashboard's HN24 / HW24 definitions, evaluated at every reading) ----
const DAY = 24 * HOUR;
// Valid HS readings: 0–600 cm and no step over 30 cm from the last accepted reading.
export function hsValues(records) {
  const out = [];
  for (const row of ordered(records)) {
    const raw = numeric(row.snowHeight);
    if (raw === null || raw < 0 || raw > 600) continue;
    if (out.length && Math.abs(raw - out.at(-1).y) > 30) continue;
    out.push({x: row.x, y: raw});
  }
  return out;
}
// value(t) − value(latest reading at or before t − 24 h), only when that baseline is within 90 min of t − 24 h.
function rolling(valid, from, to, accept) {
  const points = [];
  let j = 0;
  for (const p of valid) {
    if (p.x < from || p.x > to) continue;
    const target = p.x - DAY;
    while (j + 1 < valid.length && valid[j + 1].x <= target) j++;
    const base = valid[j];
    let y = null;
    if (base && base.x <= target && target - base.x <= MAX_GAP) y = accept(Math.round((p.y - base.y) * 10) / 10);
    points.push({x: p.x, y});
  }
  return points;
}
function summarise(points, method) {
  const valid = points.filter(p => p.y !== null);
  let peak = null;
  for (const p of valid) if (!peak || p.y > peak.y) peak = p;
  return {points: withGaps(points), latest: valid.length ? valid.at(-1) : null, peak, partial: valid.length < points.length, method};
}
// HN24 from HS: new snow over the previous 24 h; <0 or >50 cm is rejected, as on the dashboard.
// Like the dashboard, a direct new-snow sensor wins: HN24(t) = sum of valid newSnow readings in (t − 24 h, t].
export function hn24Series(records, from, to) {
  const rows = ordered(records).filter(r => r.x <= to);
  const direct = rows.map(r => ({x: r.x, v: numeric(r.newSnow)})).filter(r => r.v !== null && r.v >= 0 && r.v <= 50);
  if (direct.length) {
    const points = [];
    let i = 0, sum = 0, k = 0;
    for (const r of rows) {
      if (r.x < from) continue;
      while (k < direct.length && direct[k].x <= r.x) sum += direct[k++].v;
      while (i < k && direct[i].x <= r.x - DAY) sum -= direct[i++].v;
      const total = Math.round(sum * 10) / 10;
      points.push({x: r.x, y: i < k && total <= 50 ? total : null});
    }
    return summarise(points, 'HN');
  }
  return summarise(rolling(hsValues(records), from, to, v => (v < 0 || v > 50 ? null : v)), 'HN');
}
// Signed change in HS over the previous 24 h (settlement is negative).
export function hs24Series(records, from, to) {
  return summarise(rolling(hsValues(records), from, to, v => (Math.abs(v) > 50 ? null : v)), 'HS');
}
// HW24 from the gauge: accumulated water equivalent over the previous 24 h; >150 mm is rejected.
export function hw24Series(records, from, to) {
  const cumulative = precipitationSeries(records, from - DAY - MAX_GAP, to).points.filter(p => p.y !== null);
  return summarise(rolling(cumulative, from, to, v => (v < 0 || v > 150 ? null : v)), 'HW');
}

// ---- Interval precipitation (when it fell) and storm totals (how much) ----
// Bins are aligned to fixed-MST boundaries (MST = UTC-7) so they line up with the chart's ticks.
const MST_OFFSET = 7 * HOUR;
export function binStepHours(spanHours) { return spanHours <= 24 ? 1 : spanHours <= 72 ? 3 : 6; }
export function bins(from, to, stepHours) {
  const step = stepHours * HOUR, out = [];
  for (let start = Math.floor((from - MST_OFFSET) / step) * step + MST_OFFSET; start < to; start += step) {
    const b = {start: Math.max(start, from), end: Math.min(start + step, to)};
    b.sliver = b.end - b.start < step; // clipped by the window edge
    out.push(b);
  }
  return out;
}
// Bars at the bin mid-point; null where the bin has no valid data. Cumulative line starts at 0 at `from`
// and breaks (null) after a missing bin rather than pretending nothing fell.
function intervalResult(allBins, allValues, method, source, partial) {
  // An edge sliver with no reading in it is dropped rather than reported as missing data.
  const keep = allBins.map((b, i) => !(b.sliver && allValues[i] === null));
  const binList = allBins.filter((_, i) => keep[i]), values = allValues.filter((_, i) => keep[i]);
  const points = binList.map((b, i) => ({x: (b.start + b.end) / 2, start: b.start, end: b.end, y: values[i]}));
  const cumulative = [];
  let total = 0, any = false, broken = false, peak = null;
  binList.forEach((b, i) => {
    const v = values[i];
    if (i === 0) cumulative.push({x: b.start, y: v === null ? null : 0});
    if (v === null) { broken = true; cumulative.push({x: b.end, y: null}); return; }
    any = true;
    total = Math.round((total + v) * 10) / 10;
    cumulative.push({x: b.end, y: total});
    if (v > 0 && (!peak || v > peak.y)) peak = points[i];
  });
  return {points, cumulative, total: any ? total : null, peak, partial: partial || broken, method, source};
}
// HN per interval. A direct new-snow sensor is summed per bin. Otherwise HN comes from HS: the HS
// trace is smoothed (3 h running median), then a ratchet credits each rise of >= 2 cm above the
// last reference level as new snow and lets settlement lower the reference, so noise of a cm or
// two is not counted as snowfall and slow, steady snowfall still is.
export const HN_FROM_HS_THRESHOLD_CM = 2;
export function smoothedHs(records, windowMs = 3 * HOUR) {
  const valid = hsValues(records), out = [];
  let lo = 0, hi = 0;
  for (let i = 0; i < valid.length; i++) {
    const x = valid[i].x;
    while (valid[lo].x < x - windowMs / 2) lo++;
    while (hi + 1 < valid.length && valid[hi + 1].x <= x + windowMs / 2) hi++;
    const ys = valid.slice(lo, hi + 1).map(p => p.y).sort((a, b) => a - b);
    const m = ys.length >> 1;
    out.push({x, y: ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2});
  }
  return out;
}
export function hnIntervals(records, from, to, stepHours) {
  const binList = bins(from, to, stepHours);
  const rows = ordered(records).filter(r => r.x > from - 6 * HOUR && r.x <= to);
  const direct = rows.map(r => ({x: r.x, v: numeric(r.newSnow)})).filter(r => r.v !== null && r.v >= 0 && r.v <= 50);
  if (direct.length) {
    const values = binList.map(b => {
      const inBin = direct.filter(r => r.x > b.start && r.x <= b.end);
      return inBin.length ? Math.round(inBin.reduce((s, r) => s + r.v, 0) * 10) / 10 : null;
    });
    return intervalResult(binList, values, 'HN', 'new-snow sensor', false);
  }
  const smooth = smoothedHs(rows);
  const credit = binList.map(() => 0), seen = binList.map(() => false);
  let ref = null, last = null, partial = false;
  for (const p of smooth) {
    if (last && p.x - last.x > MAX_GAP) { ref = null; if (p.x > from) partial = true; } // a gap resets the reference
    last = p;
    if (ref === null || p.y < ref) { ref = p.y; }
    else if (p.y - ref >= HN_FROM_HS_THRESHOLD_CM) {
      const gain = p.y - ref;
      ref = p.y;
      const i = binList.findIndex(b => p.x > b.start && p.x <= b.end);
      if (i >= 0 && gain <= 50) credit[i] += gain;
    }
    const i = binList.findIndex(b => p.x > b.start && p.x <= b.end);
    if (i >= 0) seen[i] = true;
  }
  const values = credit.map((c, i) => (seen[i] ? Math.round(c * 10) / 10 : null));
  return intervalResult(binList, values, 'HN', 'HS', partial);
}
// HW per interval from the gauge (mm), using the same reset/spike rules as precipitationSeries.
export function hwIntervals(records, from, to, stepHours) {
  const binList = bins(from, to, stepHours);
  // Accumulate from a little before the window so the first interval has a baseline reading.
  const acc = precipitationSeries(records, from - 2 * HOUR, to);
  const valid = acc.points.filter(p => p.y !== null);
  const before = valid.filter(p => p.x <= from);
  let prev = before.length ? before.at(-1).y : null;
  let partial = acc.points.some(p => p.x > from && p.y === null);
  const values = binList.map(b => {
    const inBin = valid.filter(p => p.x > b.start && p.x <= b.end);
    if (!inBin.length) return null;
    const end = inBin.at(-1).y;
    if (prev === null) { prev = inBin[0].y; partial = true; } // no baseline: the first step is lost
    const v = Math.max(0, Math.round((end - prev) * 10) / 10);
    prev = end;
    return v;
  });
  return intervalResult(binList, values, 'HW', acc.method, partial);
}
// HS as depth (cm), using the dashboard's validity rules.
export function hsDepthSeries(records, from, to) {
  const points = hsValues(records).filter(p => p.x >= from && p.x <= to);
  const first = points[0] || null, latest = points.at(-1) || null;
  return {points: withGaps(points), latest, change: first && latest ? Math.round((latest.y - first.y) * 10) / 10 : null, method: 'HS'};
}
// Storm density from co-located HN (cm) and HW (mm): 1 mm of water in 1 cm of snow = 100 kg/m³.
export function stormDensity(hnTotal, hwTotal, minHn = 2) {
  if (hnTotal === null || hwTotal === null || hnTotal < minHn || hwTotal <= 0) return null;
  return Math.round(hwTotal / hnTotal * 100);
}
