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
  const points = ordered(records).filter(r => r.x >= from && r.x <= to).map(r => {
    const value = numeric(r[key]);
    return {x: r.x, y: value !== null && (metric !== 'wind' || value >= 0) ? value : null};
  });
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
