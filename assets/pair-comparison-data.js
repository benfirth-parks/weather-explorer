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
    return {x: r.x, y: value !== null && (metric !== 'wind' || value >= 0) ? value : null};
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
    return summarise(points, 'HN24');
  }
  return summarise(rolling(hsValues(records), from, to, v => (v < 0 || v > 50 ? null : v)), 'HN24');
}
// Signed change in HS over the previous 24 h (settlement is negative).
export function hs24Series(records, from, to) {
  return summarise(rolling(hsValues(records), from, to, v => (Math.abs(v) > 50 ? null : v)), 'ΔHS 24h');
}
// HW24 from the gauge: accumulated water equivalent over the previous 24 h; >150 mm is rejected.
export function hw24Series(records, from, to) {
  const cumulative = precipitationSeries(records, from - DAY - MAX_GAP, to).points.filter(p => p.y !== null);
  return summarise(rolling(cumulative, from, to, v => (v < 0 || v > 150 ? null : v)), 'HW24');
}
