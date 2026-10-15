import {HOUR, metricSeries, binStepHours, hnIntervals, hwIntervals, hsDepthSeries, stormDensity} from './pair-comparison-data.js';
import {plotForPair, renderPlotProfile} from './plot-profile.js';

/* Paired-station timing chart: temperature, wind and precipitation for both stations on one
   time axis, plus a wind rose for each station that reports usable wind. The pair card itself
   expands; nothing inside it is labelled "Compare pair". */
const host = window.weatherPairComparisonHost;
const row = document.getElementById('kpiRow');
const states = new Map();
const mounted = new Map();
const requests = new Map();
const ranges = [[24, '24 h'], [72, '72 h'], [168, '7 days'], [336, '14 days'], [480, '20 days'], [720, '30 days'], [1440, '60 days']];
/* Precipitation is drawn as interval bars (when it fell) plus a running total from the window
   start (how much), with HS drawn as snow depth on its own axis.
   HN stations: new snow in cm, from a new-snow sensor where there is one, otherwise derived from HS. */
const HN_IDS = new Set(['fts-bowsummit', 'fts-boslo', 'fts-stanley', 'fts-simplo']);
/* Stations whose HS (snow depth) is drawn. Sunshine's AB Env gauge reports a usable depth but
   its new-snow field is not usable as HN, so it gets HS depth + HW only. */
const HS_DEPTH_IDS = new Set([...HN_IDS, 'fts-sunshine']);
/* Extra gauges drawn with a pair: the Bow Summit AB Env gauge's HW alongside Bow Summit's HN. */
const EXTRA_PRECIP = {
  'fts-vulture,fts-bowsummit': [{id: 'fts-bowprecip', kind: 'hw'}]
};
/* Co-located HN (cm) and HW (mm) sources, used for storm density. */
const DENSITY_PAIRS = [['fts-bowsummit', 'fts-bowprecip']];
/* Colour encodes the station; line style encodes the data type.
   Slot 0 = first (upper) station, slot 1 = second station, slot 2 = an extra gauge drawn with the pair.
   Categorical blue / orange / aqua, stepped for each theme (checked for colour-blind separation). */
const STATION_COLORS = {light: ['#2a78d6', '#eb6834', '#1baf7a'], dark: ['#3987e5', '#d95926', '#199e70']};
const stationColor = slot => STATION_COLORS[document.documentElement.dataset.theme === 'light' ? 'light'
  : document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'][slot];
const TYPE_DASH = {temp: [], wind: [7, 4], cum: [2, 3], hsdepth: [14, 4, 3, 4]};
const TYPE_WIDTH = {temp: 2.4, wind: 1.6, cum: 1.8, hsdepth: 2};
/* Avy Control days (A/C ticked) on the pair's tab of the field sheet: red line + "Avy Control" and that day's cleanout. */
const CLEANOUT_COLOR = '#e00000';
const cleanoutRequests = new Map();
function cleanouts(ids) {
  const pair = ids.join(','), hit = cleanoutRequests.get(pair);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.promise;
  const promise = fetch(`/api/cleanouts?pair=${encodeURIComponent(pair)}`)
    .then(r => r.ok ? r.json() : {markers: []}).then(b => b.markers || []).catch(() => []);
  cleanoutRequests.set(pair, {at: Date.now(), promise});
  return promise;
}
const cleanoutPlugin = {id: 'pairCleanouts', afterDatasetsDraw(chart, _args, opts) {
  const marks = opts?.markers || [];
  if (!marks.length) return;
  const g = chart.ctx, area = chart.chartArea, x = chart.scales.x;
  g.save();
  g.strokeStyle = CLEANOUT_COLOR; g.fillStyle = CLEANOUT_COLOR; g.lineWidth = 2;
  g.font = `600 ${chart.width < 560 ? 10 : 12}px system-ui, sans-serif`;
  g.textBaseline = 'top';
  const size = chart.width < 560 ? 10 : 12;
  marks.forEach((m, i) => {
    const px = x.getPixelForValue(m.t);
    if (px < area.left || px > area.right) return;
    g.beginPath(); g.moveTo(px, area.top); g.lineTo(px, area.bottom); g.stroke();
    // "Avy Control" with the day's cleanout under it; staggered so neighbouring labels don't collide.
    const lines = ['Avy Control', m.cleanout].filter(Boolean);
    // Always to the right of the line (Ben's call), even near the right edge.
    g.textAlign = 'left';
    lines.forEach((l, k) => g.fillText(l, px + 4, area.top + 4 + (i % 3) * (2 * size + 8) + k * (size + 3)));
  });
  g.restore();
}};
/* Same CAA OGRS wind-speed classes as the dashboard wind rose (km/h). */
const WIND_CLASSES = [
  {label: 'Light (1–25)',     max: 25,       color: 'rgb(56,142,86)',  border: 'rgb(31,110,60)'},
  {label: 'Moderate (26–40)', max: 40,       color: 'rgb(240,180,50)', border: 'rgb(190,135,20)'},
  {label: 'Strong (41–60)',   max: 60,       color: 'rgb(200,60,140)', border: 'rgb(155,35,105)'},
  {label: 'Extreme (>60)',    max: Infinity, color: 'rgb(178,34,52)',  border: 'rgb(138,20,36)'}
];
const ROSE_DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const clock = new Intl.DateTimeFormat('en-CA', {timeZone:'Etc/GMT+7', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false});
const dayClock = new Intl.DateTimeFormat('en-CA', {timeZone:'Etc/GMT+7', month:'short', day:'numeric'});
const hourClock = new Intl.DateTimeFormat('en-CA', {timeZone:'Etc/GMT+7', hour:'2-digit', minute:'2-digit', hour12:false});

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
async function records(id, hours) {
  const key = `${id}:${hours}`;
  let item = requests.get(key);
  if (!item || Date.now() - item.at > 5 * 60000) {
    item = {at: Date.now()};
    item.promise = host.fetchRecords(id, hours + 26).then(data => {
      if (!Array.isArray(data)) throw new Error('Invalid archive response');
      return data;
    }).catch(error => {
      if (requests.get(key) === item) requests.delete(key);
      throw error;
    });
    requests.set(key, item);
  }
  return item.promise;
}
function destroy(view) {
  view.version++;
  view.chart?.destroy();
  view.chart = null;
  view.roseCleanup?.();
  view.roseCleanup = null;
}
/* Study-plot snow profile under the chart, for pairs at a plot. Loaded on open and on refresh,
   not on time-range changes. */
function renderProfile(view, fresh = false) {
  if (!view.plot) return;
  const opened = view.openCount;
  renderPlotProfile(view.profile, view.plot, {fresh, isCurrent: () => view.state.open && view.openCount === opened && view.card.isConnected});
}
function setOpen(view, open) {
  view.state.open = open;
  view.card.classList.toggle('pair-open', open);
  view.toggle.setAttribute('aria-expanded', String(open));
  view.panel.hidden = !open;
  if (open) { view.openCount++; render(view); renderProfile(view); } else destroy(view);
}
function mount(card) {
  const ids = card.dataset.pairIds.split(',');
  if (ids.length !== 2 || ids.some(id => !host.stations[id])) return;
  const key = ids.join(',');
  const state = states.get(key) || {open: false, hours: 24};
  states.set(key, state);
  card.classList.add('pair-expandable');
  const toggle = card.querySelector('.kpi-pair-title') || card;
  toggle.setAttribute('role', 'button');
  toggle.tabIndex = 0;
  toggle.setAttribute('aria-label', `${toggle.textContent.trim()}: show timing chart`);
  const panel = element('div', 'pair-compare');
  panel.dataset.testid = `pair-${ids[0]}`;
  panel.hidden = true;
  const controls = element('div', 'pair-compare-group');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Time range');
  const legend = element('div', 'pair-compare-legend');
  const body = element('div', 'pair-compare-body');
  const chartBox = element('div', 'pair-compare-chart');
  const canvas = element('canvas');
  canvas.setAttribute('role', 'img');
  chartBox.append(canvas);
  const roses = element('div', 'pair-compare-roses');
  roses.hidden = true;
  body.append(chartBox, legend, roses);
  const status = element('p', 'pair-compare-status');
  status.setAttribute('role', 'status');
  const note = element('p', 'pair-compare-note');
  const retry = element('button', 'pair-compare-retry', 'Retry data');
  retry.type = 'button';
  retry.hidden = true;
  const plot = plotForPair(ids);
  const profile = element('section', 'plot-profile');
  profile.hidden = true;
  if (plot) profile.setAttribute('aria-label', 'Study plot snow profile');
  panel.append(controls, body, status, note, retry, profile);
  card.append(panel);
  const view = {card, panel, toggle, state, ids, legend, body, chartBox, canvas, roses, status, note, retry, plot, profile, openCount: 0, version: 0, chart: null, roseCleanup: null, buttons: []};
  for (const [value, label] of ranges) {
    const button = element('button', '', label);
    button.type = 'button';
    button.addEventListener('click', () => { state.hours = value; render(view); });
    view.buttons.push({button, value});
    controls.append(button);
  }
  retry.addEventListener('click', () => { ids.forEach(id => requests.delete(`${id}:${state.hours}`)); render(view); });
  // The whole card toggles, except clicks inside the open chart panel.
  card.addEventListener('click', event => {
    if (panel.contains(event.target)) return;
    setOpen(view, !state.open);
  });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(view, !state.open); }
  });
  mounted.set(card, view);
  if (state.open) setOpen(view, true);
  else toggle.setAttribute('aria-expanded', 'false');
}
function peak(points) {
  let best = null;
  for (const p of points) if (p.y !== null && (!best || p.y > best.y)) best = p;
  return best;
}
function when(x, hours) { return hours === 24 ? hourClock.format(x) : clock.format(x); }

/* ---- Wind-direction arrows on the wind line ----
   One arrow at the first reading of each MST step (2 h on 24 h, 4 h on 72 h, 12 h on 7 days),
   pointing the way the wind blows toward (reported direction + 180°), as on the dashboard. */
/* Narrow (phone-width) charts double the step so arrows don't overlap. */
function arrowStepHours(hours, narrow = false) { return (hours <= 24 ? 2 : hours <= 72 ? 4 : hours <= 168 ? 12 : hours <= 480 ? 24 : 48) * (narrow ? 2 : 1); }
function markArrows(points, hours, narrow) {
  const step = arrowStepHours(hours, narrow) * HOUR, offset = 7 * HOUR;
  let lastBucket = null;
  return points.map(p => {
    if (p.y === null || p.dir === null || p.dir === undefined) return p;
    const bucket = Math.floor((p.x - offset) / step);
    if (bucket === lastBucket) return p;
    lastBucket = bucket;
    return {...p, arrow: true};
  });
}
const arrowCache = {};
function arrowImage(color) {
  if (arrowCache[color]) return arrowCache[color];
  const size = 16, cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 1.8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(8, 14); g.lineTo(8, 5); g.stroke();
  g.beginPath(); g.moveTo(8, 1); g.lineTo(12.5, 7); g.lineTo(3.5, 7); g.closePath(); g.fill();
  arrowCache[color] = cv;
  return cv;
}
const ARROW_OFFSET = 11;
const arrowPlugin = {id: 'pairWindArrows', afterDatasetsDraw(chart) {
  const g = chart.ctx, area = chart.chartArea;
  g.save();
  g.beginPath(); g.rect(area.left, area.top - ARROW_OFFSET - 8, area.right - area.left, area.bottom - area.top + ARROW_OFFSET + 8); g.clip();
  chart.data.datasets.forEach((ds, i) => {
    if (ds.kind !== 'wind' || !chart.isDatasetVisible(i)) return;
    const img = arrowImage(ds.borderColor);
    chart.getDatasetMeta(i).data.forEach((el, j) => {
      const p = ds.data[j];
      if (!p || !p.arrow) return;
      g.save(); g.translate(el.x, el.y - ARROW_OFFSET); g.rotate(((p.dir + 180) % 360) * Math.PI / 180);
      g.drawImage(img, -img.width / 2, -img.height / 2); g.restore();
    });
  });
  g.restore();
}};

/* ---- Wind rose (one per station with usable wind) ----
   Spokes show the direction the wind comes FROM, stacked by OGRS speed class; radius is % of
   non-calm readings. Calm readings (0 km/h) have no direction and are reported in the centre. */
function roseCounts(points) {
  const counts = ROSE_DIRS.map(() => WIND_CLASSES.map(() => 0));
  let calm = 0, total = 0;
  for (const p of points) {
    if (p.y === null || p.dir === null || p.dir === undefined) continue;
    total++;
    if (p.y <= 0) { calm++; continue; }
    const di = Math.floor(((p.dir % 360) + 11.25) % 360 / 22.5);
    const ci = WIND_CLASSES.findIndex(c => p.y <= c.max);
    counts[di][ci < 0 ? WIND_CLASSES.length - 1 : ci]++;
  }
  return {counts, calm, total};
}
function drawRose(canvas, rose) {
  const box = canvas.parentElement.getBoundingClientRect();
  const size = Math.max(120, Math.min(box.width, 260));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--color-text-muted').trim() || '#666';
  const grid = css.getPropertyValue('--color-border').trim() || '#ccc';
  const font = "'Courier Prime', monospace";
  const cx = size / 2, cy = size / 2, R = size / 2 - 18;
  const moving = rose.total - rose.calm;
  const dirTotals = rose.counts.map(c => c.reduce((a, b) => a + b, 0));
  const maxPct = moving ? Math.max(...dirTotals) / moving * 100 : 0;
  // Ring spacing in whole percent so the outer ring label is readable.
  const ringStep = maxPct <= 10 ? 2.5 : maxPct <= 20 ? 5 : maxPct <= 40 ? 10 : 20;
  const outerPct = Math.max(ringStep, Math.ceil(maxPct / ringStep) * ringStep);
  g.strokeStyle = grid; g.lineWidth = 0.6;
  for (let pct = ringStep; pct <= outerPct + 1e-9; pct += ringStep) {
    g.beginPath(); g.arc(cx, cy, R * pct / outerPct, 0, Math.PI * 2); g.stroke();
  }
  for (let di = 0; di < 8; di++) {
    const a = -Math.PI / 2 + di * Math.PI / 4;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
  }
  const sector = Math.PI * 2 / ROSE_DIRS.length;
  if (moving) {
    rose.counts.forEach((classes, di) => {
      const mid = -Math.PI / 2 + di * sector, a0 = mid - sector * 0.45, a1 = mid + sector * 0.45;
      let inner = 0;
      classes.forEach((count, ci) => {
        if (!count) return;
        const outer = inner + count / moving * 100 / outerPct * R;
        g.beginPath(); g.arc(cx, cy, outer, a0, a1); g.arc(cx, cy, inner, a1, a0, true); g.closePath();
        g.fillStyle = WIND_CLASSES[ci].color; g.fill();
        g.strokeStyle = WIND_CLASSES[ci].border; g.lineWidth = 0.6; g.stroke();
        inner = outer;
      });
    });
  }
  g.fillStyle = text; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `10px ${font}`;
  ['N', 'E', 'S', 'W'].forEach((label, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 2;
    g.fillText(label, cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10));
  });
  g.font = `9px ${font}`; g.textAlign = 'left';
  const ringLabelAngle = -Math.PI / 2 + sector * 1.5;
  g.fillText(`${outerPct}%`, cx + Math.cos(ringLabelAngle) * R + 2, cy + Math.sin(ringLabelAngle) * R - 6);
  if (!moving) {
    g.textAlign = 'center'; g.font = `11px ${font}`;
    g.fillText(rose.total ? 'All calm' : 'No wind data', cx, cy);
  }
}
function renderRoses(view, winds, hours) {
  view.roses.replaceChildren();
  if (!winds.length) { view.roses.hidden = true; view.body.classList.remove('has-roses'); return; }
  view.roses.hidden = false;
  view.body.classList.add('has-roses');
  const draws = [];
  for (const {name, points} of winds) {
    const rose = roseCounts(points);
    const fig = element('figure', 'pair-compare-rose');
    const cap = element('figcaption');
    cap.append(element('strong', '', name), document.createTextNode(` wind rose · ${ranges.find(r => r[0] === hours)[1]}`));
    const holder = element('div', 'pair-compare-rose-canvas');
    const canvas = element('canvas');
    canvas.setAttribute('role', 'img');
    const pct = n => rose.total ? Math.round(n / rose.total * 100) : 0;
    const top = rose.counts.map((c, i) => [ROSE_DIRS[i], c.reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1])[0];
    canvas.setAttribute('aria-label', rose.total
      ? `${name} wind rose: ${rose.total} readings, most often from ${top[0]}, ${pct(rose.calm)}% calm.`
      : `${name} wind rose: no wind data.`);
    holder.append(canvas);
    const meta = element('p', 'pair-compare-rose-meta', rose.total ? `${rose.total} readings · calm ${pct(rose.calm)}%` : '');
    fig.append(cap, holder, meta);
    view.roses.append(fig);
    draws.push(() => drawRose(canvas, rose));
  }
  const key = element('div', 'pair-compare-rose-key');
  for (const c of WIND_CLASSES) {
    const item = element('span');
    const sw = element('i');
    sw.style.background = c.color; sw.style.borderColor = c.border;
    sw.setAttribute('aria-hidden', 'true');
    item.append(sw, document.createTextNode(c.label));
    key.append(item);
  }
  view.roses.append(key);
  const redraw = () => draws.forEach(d => d());
  redraw();
  const ro = new ResizeObserver(redraw);
  ro.observe(view.roses);
  // Redraw when the site theme toggles so ring/label colours follow it.
  const mo = new MutationObserver(redraw);
  mo.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  view.roseCleanup = () => { ro.disconnect(); mo.disconnect(); };
}

async function render(view) {
  destroy(view);
  const version = view.version;
  const {state, ids} = view;
  const hours = state.hours;
  const to = Date.now(), from = to - hours * HOUR;
  view.buttons.forEach(({button, value}) => button.setAttribute('aria-pressed', String(value === hours)));
  view.panel.setAttribute('aria-busy', 'true');
  view.status.textContent = 'Loading station archive…';
  view.note.textContent = '';
  view.legend.replaceChildren();
  view.roses.replaceChildren();
  view.roses.hidden = true;
  view.chartBox.hidden = true;
  view.retry.hidden = true;
  const extras = (EXTRA_PRECIP[ids.join(',')] || []).filter(e => host.stations[e.id]);
  const [results, extraResults, cleanoutList] = await Promise.all([
    Promise.allSettled(ids.map(id => records(id, hours))),
    Promise.allSettled(extras.map(e => records(e.id, hours))),
    cleanouts(ids)
  ]);
  const cleanoutMarks = cleanoutList.filter(m => m.t >= from && m.t <= to);
  if (version !== view.version || !view.card.isConnected || !view.state.open) return;
  view.panel.setAttribute('aria-busy', 'false');

  const datasets = [], facts = [], notes = [], winds = [];
  const precipUnits = new Set();
  const step = binStepHours(hours);
  const narrow = view.body.clientWidth < 560;
  const totals = {};
  // Each series takes its station's colour; the type sets the line style.
  const line = (kind, slot) => ({borderColor: stationColor(slot), backgroundColor: stationColor(slot), borderWidth: TYPE_WIDTH[kind], borderDash: TYPE_DASH[kind]});
  // HN (cm) or HW (mm): interval bars + running-total line on the same axis.
  function addPrecip(id, data, kind, preferredSlot) {
    const name = host.stations[id].name;
    const result = kind === 'hw' ? hwIntervals(data, from, to, step) : hnIntervals(data, from, to, step);
    const label = result.method, unit = kind === 'hw' ? 'mm' : 'cm', axis = unit === 'mm' ? 'yMm' : 'yCm';
    if (result.total === null) { notes.push(`${name}: no valid ${label} in this period.`); return; }
    const slot = preferredSlot, color = stationColor(slot);
    precipUnits.add(unit);
    totals[id] = {...(totals[id] || {}), [kind]: result.total};
    datasets.push({type: 'bar', station: id, label: `${name} ${label} per ${step} h`, short: `${label} per ${step} h`, unit, kind: 'bar', method: label, slot, step, data: result.points, yAxisID: axis, order: 10,
      borderColor: color, backgroundColor: color + 'b3', borderWidth: 0,
      barPercentage: 0.9, categoryPercentage: 1, grouped: true});
    datasets.push({station: id, label: `${name} ${label} total`, short: `${label} total`, unit, kind: 'cum', slot, data: result.cumulative, yAxisID: axis, order: 4,
      ...line('cum', slot), tension: 0});
    let fact = `${name} ${label} **${result.total.toFixed(1)} ${unit}**`;
    if (result.peak) fact += `, heaviest **${result.peak.y.toFixed(1)} ${unit}/${step} h** ending ${when(result.peak.end, hours)}`;
    facts.push(fact);
    if (result.partial) notes.push(`${name}: some ${label} intervals missing (gaps or rejected readings); total is for the intervals with data.`);
  }
  function addDepth(id, data, preferredSlot) {
    const name = host.stations[id].name, hs = hsDepthSeries(data, from, to);
    if (!hs.latest) { notes.push(`${name}: no valid HS in this period.`); return; }
    const slot = preferredSlot;
    datasets.push({station: id, label: `${name} HS depth`, short: 'HS depth', unit: 'cm', kind: 'hsdepth', slot, data: hs.points, yAxisID: 'yHs', order: 3,
      ...line('hsdepth', slot), tension: 0.2});
    const sign = hs.change > 0 ? '+' : '';
    facts.push(`${name} HS **${hs.latest.y.toFixed(0)} cm**${hs.change !== null ? ` (${sign}${hs.change.toFixed(1)} cm over the period)` : ''}`);
  }
  results.forEach((result, i) => {
    const id = ids[i], station = host.stations[id];
    const name = station.name;
    if (result.status === 'rejected') {
      notes.push(`${name}: archive unavailable.`);
      view.retry.hidden = false;
      return;
    }
    const data = result.value;
    const temp = metricSeries(data, 'temperature', from, to);
    if (temp.points.some(p => p.y !== null)) {
      datasets.push({station: id, label: `${name} temp`, short: 'Temperature', unit: '°C', kind: 'temp', slot: i, data: temp.points, yAxisID: 'yTemp', order: 1,
        ...line('temp', i), tension: 0.2});
    } else notes.push(`${name}: no valid temperature.`);
    if (!host.hiddenWindIds.has(id)) {
      const wind = metricSeries(data, 'wind', from, to);
      if (wind.points.some(p => p.y !== null)) {
        datasets.push({station: id, label: `${name} wind`, short: 'Wind', unit: 'km/h', kind: 'wind', slot: i, data: markArrows(wind.points, hours, narrow), yAxisID: 'yWind', order: 2,
          ...line('wind', i), tension: 0.2});
        const pk = peak(wind.points);
        if (pk) facts.push(`${name} peak wind **${pk.y.toFixed(0)} km/h** at ${when(pk.x, hours)}`);
        winds.push({name, points: wind.points});
      }
    }
    if (HN_IDS.has(id)) addPrecip(id, data, 'hn', i);
    else if (!host.noPrecipGaugeIds.has(id)) addPrecip(id, data, 'hw', i);
    if (HS_DEPTH_IDS.has(id)) addDepth(id, data, i);
  });

  extraResults.forEach((result, i) => {
    const id = extras[i].id;
    if (result.status === 'fulfilled') addPrecip(id, result.value, extras[i].kind, 2);
    else notes.push(`${host.stations[id].name}: archive unavailable.`);
  });
  // Storm density where HN and HW come from the same site.
  for (const [hnId, hwId] of DENSITY_PAIRS) {
    const density = stormDensity(totals[hnId]?.hn ?? null, totals[hwId]?.hw ?? null);
    if (density !== null) facts.push(`${host.stations[hnId].name} new-snow density ≈ **${density} kg/m³** (HW ${totals[hwId].hw.toFixed(1)} mm ÷ HN ${totals[hnId].hn.toFixed(1)} cm)`);
  }

  if (!datasets.length) {
    view.status.textContent = 'No usable data for this pair in the selected period.';
    return;
  }
  if (typeof window.Chart !== 'function') {
    view.status.textContent = 'Chart library unavailable. Reload the page to try again.';
    return;
  }
  // Legend beside the chart: grouped by station (its colour), one entry per series drawn in the
  // chart's line style. Clicking an entry shows or hides that series (assets/legend-toggle.js).
  const entries = [];
  for (const station of [...new Set(datasets.map(d => d.station))]) {
    const group = element('div', 'pair-compare-legend-group');
    const first = datasets.find(d => d.station === station);
    const head = element('div', 'pair-compare-legend-head');
    const dot = element('i');
    dot.style.background = first.borderColor;
    dot.setAttribute('aria-hidden', 'true');
    head.append(dot, document.createTextNode(host.stations[station].name));
    group.append(head);
    for (const d of datasets.filter(d => d.station === station)) {
      const item = element('span');
      const swatch = element('i', `pair-compare-swatch ${d.kind}`);
      swatch.style.borderColor = d.borderColor;
      if (d.kind === 'bar') swatch.style.background = d.backgroundColor;
      else swatch.style.borderImage = d.borderDash.length ? `repeating-linear-gradient(90deg, ${d.borderColor} 0 ${d.borderDash[0]}px, transparent ${d.borderDash[0]}px ${d.borderDash[0] + d.borderDash[1]}px) 1` : '';
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, document.createTextNode(`${d.short} (${d.unit})`));
      group.append(item);
      entries[datasets.indexOf(d)] = item;
    }
    view.legend.append(group);
  }
  view.status.innerHTML = facts.map(f => f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')).join(' · ');
  const hasDepth = datasets.some(d => d.kind === 'hsdepth');
  view.note.textContent = notes.join(' ');
  view.chartBox.hidden = false;
  view.canvas.setAttribute('aria-label', `Temperature, wind and precipitation timing for ${ids.map(id => host.stations[id].name).join(' and ')}.`);
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--color-text-muted').trim();
  const grid = css.getPropertyValue('--color-divider').trim();
  const tick = {color: text, font: {size: narrow ? 9 : 11}};
  // Phone width: tick colours identify each y-axis, so titles are dropped to give the plot room.
  const axisTick = {...tick, ...(narrow ? {maxTicksLimit: 6, padding: 1} : {})};
  const axisName = label => ({display: true, text: label, color: text, font: {size: narrow ? 9 : 11}, padding: narrow ? 0 : 4});
  const axisTitle = unit => [...new Set(datasets.filter(d => d.unit === unit && d.kind === 'bar').map(d => d.method))].join(' / ') + ' ' + unit;
  const hasWind = datasets.some(d => d.kind === 'wind');
  view.chart = new window.Chart(view.canvas, {
    type: 'line',
    data: {datasets: datasets.map(d => ({...d, parsing: false, pointRadius: 0, pointHitRadius: 10, spanGaps: false, fill: d.fill || false}))},
    plugins: [arrowPlugin, cleanoutPlugin],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: {padding: {top: hasWind ? 14 : 0}},
      interaction: {mode: 'x', intersect: false},
      plugins: {legend: {display: false}, pairCleanouts: {markers: cleanoutMarks}, tooltip: {callbacks: {
        title: items => items.length ? `${clock.format(items[0].parsed.x)} MST` : '',
        label: c => {
          const p = c.raw || {};
          if (c.dataset.kind === 'bar' && p.start !== undefined) return `${c.dataset.label}: ${c.parsed.y?.toFixed(1)} ${c.dataset.unit} (${hourClock.format(p.start)}–${hourClock.format(p.end)})`;
          const dir = c.dataset.kind === 'wind' && p.dir !== null && p.dir !== undefined ? ` from ${ROSE_DIRS[Math.floor(((p.dir % 360) + 11.25) % 360 / 22.5)]} (${Math.round(p.dir)}°)` : '';
          return `${c.dataset.label}: ${c.parsed.y?.toFixed(1)} ${c.dataset.unit}${dir}`;
        }
      }}},
      scales: {
        x: {type: 'time', min: from, max: to, offset: false, grid: {color: grid},
          // Ticks on fixed-MST boundaries (MST midnight = 07:00 UTC), independent of the viewer's time zone.
          afterBuildTicks: axis => {
            const step = (hours === 24 ? 6 : hours === 72 ? 12 : hours <= 168 ? 24 : hours <= 480 ? 48 : hours <= 720 ? 96 : 168) * HOUR, offset = 7 * HOUR;
            const ticks = [];
            for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) ticks.push({value: t});
            axis.ticks = ticks;
          },
          ticks: {...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
            callback: value => hours === 24 ? hourClock.format(value) : (hours === 72 ? `${dayClock.format(value)} ${hourClock.format(value)}` : dayClock.format(value))}},
        yTemp: {display: 'auto', position: 'left', title: axisName('°C'), grid: {color: grid}, ticks: axisTick},
        yWind: {display: hasWind ? 'auto' : false, position: 'right', beginAtZero: true, title: axisName(narrow ? 'km/h' : 'Wind km/h'), grid: {drawOnChartArea: false}, ticks: axisTick},
        yHs: {display: hasDepth ? 'auto' : false, position: 'left', title: axisName(narrow ? 'HS' : 'HS cm'), grid: {drawOnChartArea: false}, ticks: axisTick,
          grace: '10%'},
        yCm: {display: precipUnits.has('cm') ? 'auto' : false, position: 'right', beginAtZero: true, title: axisName(axisTitle('cm')), grid: {drawOnChartArea: false}, ticks: axisTick,
          suggestedMax: 2},
        yMm: {display: precipUnits.has('mm') ? 'auto' : false, position: 'right', beginAtZero: true, title: axisName(axisTitle('mm')), grid: {drawOnChartArea: false}, ticks: axisTick,
          suggestedMax: 2}
      }
    }
  });
  window.bindLegendToggles?.(view.chart, entries, datasets.map(d => `${d.station}:${d.kind}`), `pair:${ids.join(',')}`);
  renderRoses(view, winds, hours);
}
function scan() {
  for (const [card, view] of mounted) if (!card.isConnected) { destroy(view); mounted.delete(card); }
  row.querySelectorAll('.kpi-pair[data-pair-ids]').forEach(card => { if (!mounted.has(card)) mount(card); });
}
if (host && row) {
  new MutationObserver(scan).observe(row, {childList: true});
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    requests.clear(); cleanoutRequests.clear();
    for (const view of mounted.values()) if (view.state.open) { render(view); renderProfile(view, true); }
  });
  scan();
}
