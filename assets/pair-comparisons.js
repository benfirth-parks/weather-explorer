import {HOUR, metricSeries, precipitationSeries, matchedDifference} from './pair-comparison-data.js';

const host = window.weatherPairComparisonHost;
const row = document.getElementById('kpiRow');
const states = new Map();
const mounted = new Map();
const requests = new Map();
const metrics = {temperature: ['Temperature', '°C'], wind: ['Wind', 'km/h'], precipitation: ['Precipitation', 'mm']};
const ranges = [[24, '24 h'], [168, '7 days'], [720, '30 days']];
const clock = new Intl.DateTimeFormat('en-CA', {timeZone:'Etc/GMT+7', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false});
const axisClock = new Intl.DateTimeFormat('en-CA', {timeZone:'Etc/GMT+7', month:'short', day:'numeric'});
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
    item.promise = host.fetchRecords(id, hours + 2).then(data => {
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
}
function mount(card) {
  const ids = card.dataset.pairIds.split(',');
  if (ids.length !== 2 || ids.some(id => !host.stations[id])) return;
  const key = ids.join(',');
  const state = states.get(key) || {open: false, metric: 'temperature', hours: 24};
  states.set(key, state);
  const details = element('details', 'pair-compare');
  details.dataset.testid = `pair-${ids[0]}`;
  const summary = element('summary', '', 'Compare pair');
  summary.setAttribute('aria-label', `Compare ${ids.map(id => host.stations[id].name).join(' and ')}`);
  details.append(summary);
  const body = element('div', 'pair-compare-body');
  const controls = element('div', 'pair-compare-controls');
  const legend = element('div', 'pair-compare-legend');
  const chartBox = element('div', 'pair-compare-chart');
  const canvas = element('canvas');
  canvas.setAttribute('role', 'img');
  chartBox.append(canvas);
  const status = element('p', 'pair-compare-status');
  status.setAttribute('role', 'status');
  const note = element('p', 'pair-compare-note');
  const retry = element('button', 'pair-compare-retry', 'Retry data');
  retry.type = 'button';
  retry.hidden = true;
  body.append(controls, legend, chartBox, status, note, retry);
  details.append(body);
  const view = {card, details, state, ids, legend, chartBox, canvas, status, note, retry, body, version: 0, chart: null, buttons: []};
  for (const [kind, options] of [['metric', Object.entries(metrics).map(([k,v]) => [k,v[0]])], ['hours', ranges]]) {
    const group = element('div', 'pair-compare-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', kind === 'metric' ? 'Comparison metric' : 'Comparison time range');
    for (const [value, label] of options) {
      const button = element('button', '', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(state[kind] === value));
      button.addEventListener('click', () => { state[kind] = value; render(view); });
      view.buttons.push({button, kind, value});
      group.append(button);
    }
    controls.append(group);
  }
  retry.addEventListener('click', () => {
    ids.forEach(id => requests.delete(`${id}:${state.hours}`));
    render(view);
  });
  details.addEventListener('toggle', () => {
    state.open = details.open;
    if (details.open) render(view);
    else destroy(view);
  });
  card.append(details);
  mounted.set(card, view);
  // Set after listener attachment so restored open panels use the same lazy-loading path.
  details.open = state.open;
}
async function render(view) {
  destroy(view);
  const version = view.version;
  const {state, ids} = view;
  const metric = state.metric, hours = state.hours;
  const to = Date.now(), from = to - hours * HOUR;
  const unit = metrics[metric][1];
  view.buttons.forEach(({button, kind, value}) => button.setAttribute('aria-pressed', String(state[kind] === value)));
  view.body.setAttribute('aria-busy', 'true');
  view.status.textContent = 'Loading station archive…';
  view.note.textContent = '';
  view.legend.replaceChildren();
  view.chartBox.hidden = true;
  view.retry.hidden = true;
  const results = await Promise.allSettled(ids.map(id => records(id, hours)));
  if (version !== view.version || !view.card.isConnected || !view.details.open) return;
  view.body.setAttribute('aria-busy', 'false');
  const notes = [];
  const series = results.map((result, i) => {
    const id = ids[i], station = host.stations[id];
    const unsupported = (metric === 'wind' && host.hiddenWindIds.has(id)) ||
      (metric === 'precipitation' && host.noPrecipGaugeIds.has(id));
    let data = {points: [], partial: false}, reason = '';
    if (unsupported) reason = metric === 'wind' ? 'wind not supported' : 'no precipitation gauge';
    else if (result.status === 'rejected') {
      reason = 'archive unavailable';
      view.retry.hidden = false;
    } else {
      data = metric === 'precipitation' ? precipitationSeries(result.value, from, to) : metricSeries(result.value, metric, from, to);
      if (!data.points.some(p => p.y !== null)) reason = 'no valid observations';
    }
    const valid = data.points.filter(p => p.y !== null);
    if (!reason && valid.length) {
      const first = valid[0].x, last = valid.at(-1).x;
      if (first - from > 2 * HOUR) notes.push(`${station.name}: shorter archive coverage (${clock.format(first)} to ${clock.format(last)} MST).`);
      if (to - last > 2.5 * HOUR) notes.push(`${station.name}: latest usable reading ${clock.format(last)} MST.`);
      if (data.partial) notes.push(`${station.name}: partial accumulation; missing readings, resets or rejected steps are excluded.`);
    }
    const label = element('span');
    const swatch = element('i', 'pair-compare-swatch');
    swatch.style.borderColor = station.color;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(swatch, document.createTextNode(`${station.name} · ${station.elevation} m${reason ? ' · ' + reason : ''}`));
    view.legend.append(label);
    return {station, ...data, valid, reason};
  });
  const available = series.filter(s => s.valid.length);
  if (!available.length) view.status.textContent = `No usable ${metrics[metric][0].toLowerCase()} data for this pair in the selected period.`;
  else if (available.length < 2) view.status.textContent = `Showing ${available[0].station.name} only; a two-station comparison is unavailable for this metric.`;
  else if (metric === 'precipitation') {
    view.status.textContent = series.map(s => `${s.station.name}: ${s.total.toFixed(1)} mm of measured accumulation`).join('; ') + '.';
  } else {
    const match = matchedDifference(series[0].points, series[1].points);
    view.status.textContent = match.count
      ? `${series[0].station.name} averaged ${Math.abs(match.difference).toFixed(1)} ${unit} ${metric === 'temperature' ? (match.difference >= 0 ? 'warmer' : 'colder') : (match.difference >= 0 ? 'windier' : 'less windy')} than ${series[1].station.name} across ${match.count} matched observations (within 30 min).`
      : 'Both stations have readings, but no observations align within 30 minutes; no difference is calculated.';
  }
  view.note.textContent = [
    `Rolling ${ranges.find(r => r[0] === hours)[1]} ending ${clock.format(to)} MST. Times use fixed MST (UTC−7).`,
    metric === 'precipitation' ? 'Measured accumulation, not snowfall. Incomplete periods are not full-window totals.' : 'Original observation times; gaps over 90 min are not connected.',
    ...notes
  ].join(' ');
  if (!available.length) return;
  if (typeof window.Chart !== 'function') {
    view.status.textContent = 'Chart library unavailable. Reload the page to try again.';
    return;
  }
  view.chartBox.hidden = false;
  view.canvas.setAttribute('aria-label', `${metrics[metric][0]} comparison in ${unit}. ${view.status.textContent}`);
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--color-text-muted').trim();
  const grid = css.getPropertyValue('--color-divider').trim();
  view.chart = new window.Chart(view.canvas, {
    type: 'line',
    data: {datasets: series.map((s, i) => ({
      label: `${s.station.name} (${s.station.elevation} m)`,
      data: s.points, parsing: false, borderColor: s.station.color,
      borderDash: i ? [6, 4] : [], backgroundColor: s.station.color,
      borderWidth: 2, pointRadius: s.valid.length < 2 ? 3 : 0,
      pointHitRadius: 12, tension: 0, spanGaps: false, fill: false
    }))},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: {mode: 'nearest', intersect: false},
      plugins: {legend: {display: false}, tooltip: {callbacks: {
        title: items => items.length ? `${clock.format(items[0].parsed.x)} MST` : '',
        label: context => `${context.dataset.label}: ${context.parsed.y?.toFixed(1)} ${unit}`
      }}},
      scales: {
        x: {type: 'time', min: from, max: to, time: {unit: hours === 24 ? 'hour' : 'day', stepSize: hours === 24 ? 6 : hours === 168 ? 2 : 7}, grid: {color: grid}, ticks: {
          color: text, maxTicksLimit: 5, maxRotation: 0, font: {size: 11},
          callback: value => hours === 24 ? hourClock.format(value) : axisClock.format(value)
        }},
        y: {beginAtZero: metric !== 'temperature', title: {display: true, text: unit, color: text},
          grid: {color: grid}, ticks: {color: text, font: {size: 11}}}
      }
    }
  });
}
function scan() {
  for (const [card, view] of mounted) {
    if (!card.isConnected) { destroy(view); mounted.delete(card); }
  }
  row.querySelectorAll('.kpi-pair[data-pair-ids]').forEach(card => {
    if (!mounted.has(card)) mount(card);
  });
}
if (host && row) {
  new MutationObserver(scan).observe(row, {childList: true});
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    requests.clear();
    for (const view of mounted.values()) if (view.details.open) render(view);
  });
  scan();
}
