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
// Bins are aligned to fixed Alberta-time boundaries (UTC-6 year-round since Nov 2026) so they line up with the chart's ticks.
const MST_OFFSET = 6 * HOUR;
// HN and HW bars are hourly at every span (Ben, 30 Oct 2026).
export function binStepHours() { return 1; }
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
// HS ratchet: each rise of >= HN_FROM_HS_THRESHOLD_CM in the smoothed trace above the last reference
// level is a credit {x, gain}; settlement lowers the reference and a gap over MAX_GAP resets it.
// threshold(x) gives the step (cm) at time x; HN_FROM_HS_THRESHOLD_CM by default.
function hsCredits(rows, windowMs, from, threshold = () => HN_FROM_HS_THRESHOLD_CM) {
  const credits = [], seen = [];
  let ref = null, last = null, partial = false;
  for (const p of smoothedHs(rows, windowMs)) {
    if (last && p.x - last.x > MAX_GAP) { ref = null; if (p.x > from) partial = true; }
    last = p;
    seen.push(p.x);
    if (ref === null || p.y < ref) { ref = p.y; }
    else if (p.y - ref >= threshold(p.x)) {
      const gain = p.y - ref;
      ref = p.y;
      if (gain <= 50) credits.push({x: p.x, gain});
    }
  }
  return {credits, seen, partial};
}

/* Gauge check (Ben, 3 Nov 2026), for the stations in HN_GAUGE_CHECK_IDS. Sunshine's depth sensor jitters a
   couple of cm every reading, which the HS ratchet was counting as new snow on dry days. A depth rise only
   counts as HN when the gauge logged at least GAUGE_CONFIRM_MM in the GAUGE_BEFORE_H before it (up to
   GAUGE_AFTER_H after). A frozen or stuck gauge reads flat like a dry day, so the gauge is taken as stuck
   when it has not moved for STUCK_FLAT_H while the depth (STUCK_SMOOTH_H running median) rose a net
   STUCK_RISE_CM or more within STUCK_RISE_WINDOW_H; it stays stuck until it moves GAUGE_CONFIRM_MM again.
   RDPS back check (Ben, 4 Nov 2026): the RDPS forecast (GEM Regional hourly precipitation, assets/rdps.js)
   says whether precipitation was expected. A depth rise the gauge did not confirm still counts when RDPS
   expected RDPS_EXPECT_MM or more over the same window, since precipitation that was forecast but not
   received points at the gauge, not the sky. While the gauge is stuck, a rise counts unless RDPS was dry
   (under RDPS_DRY_MM over the window); with no gauge and no RDPS data, HN comes from depth alone. All HN uses the 3 h running median (Ben, 4 Nov 2026); the
   STUCK_SMOOTH_H median only drives the stuck test.
   Simpson Lower (Ben, 5 Nov 2026) has no gauge, and its depth dips a couple of cm each afternoon and
   recovers by evening, which the ratchet counted as new snow. Stations with no gauge (HN_NO_GAUGE_IDS) count
   a depth rise only when RDPS expected RDPS_EXPECT_MM or more over the window. gauge is then 'forecast' (no
   gauge, rises checked against RDPS alone), or 'missing' with no RDPS data, when HN comes from depth alone.
   Every station whose HN comes from its depth sensor is checked this way (Ben, 5 Nov 2026): gauge stations
   by the gauge and RDPS as at Sunshine, gauge-less ones by RDPS alone. Each needs an RDPS point in
   netlify/functions/_rdps.mjs. index.html and mobile.html keep inline copies of both sets. */
export const HN_GAUGE_CHECK_IDS = new Set(['fts-sunshine', 'fts-simplo', 'fts-boslo', 'fts-bowsummit', 'fts-stanley', 'fts-bowprecip', 'fts-pikarun', 'fts-coleman', 'fts-bigbend', 'fts-maligne', 'fts-summitlake', 'fts-akamina']);
export const HN_NO_GAUGE_IDS = new Set(['fts-simplo', 'fts-boslo', 'fts-bowsummit', 'fts-stanley']);
/* Nearby gauge (Ben, 7 Nov 2026): Simpson Lower has no gauge, and RDPS can fall just short of RDPS_EXPECT_MM in
   a real light snowfall (6 Nov: 2 cm of depth, RDPS 0.9 mm, Vermillion's gauge 0.33 mm). For a station listed
   here, a depth rise also counts when that neighbour's gauge logged GAUGE_CONFIRM_MM or more over the same
   window. The neighbour's hourly HW rides on the RDPS points as `forecast.neighbourGauge` ([{x: hour end, y: mm}],
   from /api/rdps and _rdps.mjs fetchBackCheck), so every caller that passes the RDPS forecast gets it. */
export const NEIGHBOUR_GAUGE_IDS = {'fts-simplo': 'fts-vermillion'};
/* Hourly gauge increments [{x: hour end (ms), y: mm}] from a station's records, by precipitationSeries' rules. */
export function hourlyGauge(records, from, to) {
  const pts = precipitationSeries(records, from, to).points;
  const byHour = new Map();
  let prev = null;
  for (const p of pts) {
    if (p.y === null) { prev = null; continue; }
    if (prev !== null) {
      const end = Math.ceil(p.x / HOUR) * HOUR;
      byHour.set(end, Math.round(((byHour.get(end) || 0) + Math.max(0, p.y - prev)) * 100) / 100);
    }
    prev = p.y;
  }
  return [...byHour].map(([x, y]) => ({x, y})).sort((a, b) => a.x - b.x);
}
export const GAUGE_CONFIRM_MM = 0.2;
export const GAUGE_BEFORE_H = 6;
export const GAUGE_AFTER_H = 2;
export const STUCK_FLAT_H = 24;
export const STUCK_RISE_CM = 5;
export const STUCK_RISE_WINDOW_H = 6;
export const STUCK_SMOOTH_H = 6;
export const RDPS_EXPECT_MM = 1;
export const RDPS_DRY_MM = 0.2;
/* Step while precipitation is confirmed (Ben, 6 Nov 2026): during a storm, with the gauge or RDPS showing
   precipitation, the ratchet credits each 1 cm rise, so slow snowfall (about 1 cm/h) is counted in full and
   the last cm of a storm is not held back. Dry or unconfirmed periods keep the 2 cm step (and the checks
   below still drop their rises), since a depth change then is sensor noise. */
export const HN_CONFIRMED_THRESHOLD_CM = 1;
// Forecast precipitation (mm) for hours ending in (a, b]; null with no forecast hours there.
function forecastBetween(forecast, a, b) {
  if (!forecast || !forecast.length) return null;
  let sum = 0, n = 0;
  for (const p of forecast) if (p.x > a && p.x <= b && Number.isFinite(p.y)) { sum += p.y; n++; }
  return n ? Math.round(sum * 100) / 100 : null;
}
// The gauge's accumulated total over time (null-free), from precipitationSeries' reset/spike rules.
function gaugeTrace(records, to) {
  const rows = ordered(records).filter(r => r.x <= to);
  if (!rows.length) return [];
  return precipitationSeries(rows, rows[0].x, to).points.filter(p => p.y !== null);
}
function gaugeAt(trace, t) {
  let lo = 0, hi = trace.length - 1, hit = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (trace[m].x <= t) { hit = trace[m]; lo = m + 1; } else hi = m - 1; }
  return hit && t - hit.x <= 3 * HOUR ? hit.y : null;
}
function gaugeBetween(trace, a, b) {
  const x = gaugeAt(trace, a), y = gaugeAt(trace, b);
  return x === null || y === null ? null : Math.max(0, Math.round((y - x) * 100) / 100); // to 0.01 mm, so float error can't flip the 0.2 mm test
}
// Times the gauge is taken as stuck: [{start, end}] (end Infinity while still stuck at `to`).
function stuckPeriods(trace, rows, to) {
  const s6 = smoothedHs(rows, STUCK_SMOOTH_H * HOUR), periods = [];
  let lo = 0;
  for (let i = 0; i < s6.length; i++) {
    const p = s6[i];
    if (periods.length && p.x <= periods.at(-1).end) continue;
    while (s6[lo].x < p.x - STUCK_RISE_WINDOW_H * HOUR) lo++;
    let base = Infinity;
    for (let j = lo; j <= i; j++) base = Math.min(base, s6[j].y);
    if (p.y - base < STUCK_RISE_CM) continue;
    const flat = gaugeBetween(trace, p.x - STUCK_FLAT_H * HOUR, p.x);
    if (flat === null || flat >= GAUGE_CONFIRM_MM) continue;
    const at = gaugeAt(trace, p.x);
    const moved = trace.find(g => g.x > p.x && g.x <= to && g.y - at >= GAUGE_CONFIRM_MM);
    periods.push({start: p.x - STUCK_RISE_WINDOW_H * HOUR, end: moved ? moved.x : Infinity});
  }
  return periods;
}
/* HN credits for a gauge-checked station; the gauge records default to the depth records. forecast is the
   RDPS hourly precipitation [{x: hour end (ms), y: mm}], or null when it is not available.
   gauge: 'stuck' or 'missing' (at `to`), 'forecast' when there is no gauge data at all but RDPS is there (rises
   then count on RDPS alone), 'rdps' when a rise in the window counted on the RDPS forecast alone, else 'ok'. */
export function gaugeCheckedCredits(records, from, to, gaugeRecords = records, forecast = null) {
  const rows = ordered(records).filter(r => r.x > from - 30 * HOUR && r.x <= to);
  const trace = gaugeTrace((gaugeRecords || records).filter(r => { const x = Date.parse(r.measurementDateTime); return x > from - 60 * HOUR && x <= to; }), to);
  const stuck = stuckPeriods(trace, rows, to);
  const inStuck = t => stuck.some(s => t >= s.start && t <= s.end);
  const gaugeHw = t => gaugeBetween(trace, t - GAUGE_BEFORE_H * HOUR, Math.min(t + GAUGE_AFTER_H * HOUR, to));
  const expected = t => forecastBetween(forecast, t - GAUGE_BEFORE_H * HOUR, t + GAUGE_AFTER_H * HOUR);
  const nearbyGauge = forecast && Array.isArray(forecast.neighbourGauge) ? forecast.neighbourGauge : null;
  const nearby = t => { const n = forecastBetween(nearbyGauge, t - GAUGE_BEFORE_H * HOUR, t + GAUGE_AFTER_H * HOUR); return n !== null && n >= GAUGE_CONFIRM_MM; };
  // Precipitation positively confirmed around t: the gauge, RDPS, or (gauge stuck) RDPS not dry.
  const confirmed = t => {
    const g = gaugeHw(t), f = expected(t);
    if (nearby(t)) return true;
    if (inStuck(t)) return f !== null && f >= RDPS_DRY_MM;
    return (g !== null && g >= GAUGE_CONFIRM_MM) || (f !== null && f >= RDPS_EXPECT_MM);
  };
  const r3 = hsCredits(rows, 3 * HOUR, from, t => (confirmed(t) ? HN_CONFIRMED_THRESHOLD_CM : HN_FROM_HS_THRESHOLD_CM));
  let onForecast = false;
  const credits = r3.credits.filter(c => {
    const g = gaugeHw(c.x), f = expected(c.x);
    if (nearby(c.x)) return true;
    if (inStuck(c.x)) return f === null || f >= RDPS_DRY_MM;
    if (g !== null && g >= GAUGE_CONFIRM_MM) return true;
    if (f !== null && f >= RDPS_EXPECT_MM) { if (c.x > from && c.x <= to) onForecast = true; return true; }
    return g === null && f === null;
  });
  const gauge = !trace.length ? (forecast && forecast.length ? 'forecast' : 'missing')
    : !inStuck(to) && gaugeHw(to) === null ? 'missing' : inStuck(to) ? 'stuck' : onForecast ? 'rdps' : 'ok';
  return {credits, seen: r3.seen, partial: r3.partial, stuck, gauge};
}
/* The gauge's state at `to` for a gauge-checked station: 'ok', 'stuck', 'missing', 'forecast' or 'rdps'. */
export function gaugeState(records, to, forecast = null) {
  return gaugeCheckedCredits(records, to - 24 * HOUR, to, records, forecast).gauge;
}
export function hnIntervals(records, from, to, stepHours, {gaugeCheck = false, gaugeRecords = null, forecast = null} = {}) {
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
  const {credits: all, seen, partial, gauge} = gaugeCheck ? gaugeCheckedCredits(records, from, to, gaugeRecords || records, forecast) : hsCredits(rows, 3 * HOUR, from);
  const credit = binList.map(() => 0), seenBin = binList.map(() => false);
  const binOf = x => binList.findIndex(b => x > b.start && x <= b.end);
  for (const c of all) { const i = binOf(c.x); if (i >= 0) credit[i] += c.gain; }
  for (const x of seen) { if (x > from) { const i = binOf(x); if (i >= 0) seenBin[i] = true; } }
  const values = credit.map((c, i) => (seenBin[i] ? Math.round(c * 10) / 10 : null));
  const result = intervalResult(binList, values, 'HN', 'HS', partial);
  if (gaugeCheck) result.gauge = gauge;
  return result;
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
/* HSΔ, the HS change since the start of the range (Ben, 10 Nov 2026; "Delta" in Conlan, ISSW 2026): at each step's
   end, the median HS of the readings within 90 min (none later), minus the same median at the range start, and 0 when
   it is lower. Drawn beside the HN running total as a check, never used to change HN. It reads low when the pack
   settles, so in a storm it usually runs under HN; it still includes snow that fell while the depth sensor was not
   reporting, which HN misses because its ratchet restarts after a gap over 90 min. When the range start has no
   reading, the first median after it is the base and the series is partial. */
export function hsDeltaSeries(records, from, to, stepHours) {
  const hs = hsValues(records).filter(p => p.x <= to);
  const median = t => {
    const ys = hs.filter(p => Math.abs(p.x - t) <= 1.5 * HOUR && p.x <= t).map(p => p.y).sort((a, b) => a - b);
    if (!ys.length) return null;
    const m = ys.length >> 1;
    return ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
  };
  const ends = bins(from, to, stepHours).map(b => b.end);
  let base = median(from), partial = base === null;
  const points = [{x: from, y: base === null ? null : 0}];
  for (const t of ends) {
    const m = median(t);
    if (base === null && m !== null) base = m;
    points.push({x: t, y: m === null || base === null ? null : Math.round(Math.max(0, m - base) * 10) / 10});
  }
  if (points.some(p => p.y === null)) partial = true;
  const valid = points.filter(p => p.y !== null);
  return {points, total: valid.length > 1 ? valid.at(-1).y : null, partial, method: 'HSΔ'};
}
// Storm density from co-located HN (cm) and HW (mm): 1 mm of water in 1 cm of snow = 100 kg/m³.
export function stormDensity(hnTotal, hwTotal, minHn = 2) {
  if (hnTotal === null || hwTotal === null || hnTotal < minHn || hwTotal <= 0) return null;
  return Math.round(hwTotal / hnTotal * 100);
}
