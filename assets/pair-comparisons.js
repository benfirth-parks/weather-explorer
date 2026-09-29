import {HOUR, metricSeries, hn24Series, hs24Series, hw24Series} from './pair-comparison-data.js';

/* Paired-station timing chart: temperature, wind and precipitation for both stations on one
   time axis. The pair card itself expands; nothing inside it is labelled "Compare pair". */
const host = window.weatherPairComparisonHost;
const row = document.getElementById('kpiRow');
const states = new Map();
const mounted = new Map();
const requests = new Map();
const ranges = [[24, '24 h'], [72, '72 h'], [168, '7 days']];
/* These stations report precipitation from HS (cm), not gauge HW. */
const HS_PRECIP_IDS = new Set(['fts-bowsummit', 'fts-boslo', 'fts-stanley', 'fts-simplo']);
/* Pairs whose precipitation is drawn as rolling HN24 / HW24 bars; all others show the rolling 24 h change in HS. */
const BAR_PAIRS = new Set(['fts-vulture,fts-bowsummit', 'fts-lookout,fts-sunshine']);
/* Extra 24 h precipitation bars: the Bow Summit AB Env gauge's HW24 alongside Bow Summit's HN24.
   (Sunshine's own gauge HW24 is already drawn; its new-snow field is not usable as HN24.) */
const EXTRA_PRECIP = {
  'fts-vulture,fts-bowsummit': [{id: 'fts-bowprecip', kind: 'hw24'}]
};
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
}
function setOpen(view, open) {
  view.state.open = open;
  view.card.classList.toggle('pair-open', open);
  view.toggle.setAttribute('aria-expanded', String(open));
  view.panel.hidden = !open;
  if (open) render(view); else destroy(view);
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
  panel.append(controls, chartBox, legend, status, note, retry);
  card.append(panel);
  const view = {card, panel, toggle, state, ids, legend, chartBox, canvas, status, note, retry, version: 0, chart: null, buttons: []};
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
  view.chartBox.hidden = true;
  view.retry.hidden = true;
  const extras = (EXTRA_PRECIP[ids.join(',')] || []).filter(e => host.stations[e.id]);
  const [results, extraResults] = await Promise.all([
    Promise.allSettled(ids.map(id => records(id, hours))),
    Promise.allSettled(extras.map(e => records(e.id, hours)))
  ]);
  if (version !== view.version || !view.card.isConnected || !view.state.open) return;
  view.panel.setAttribute('aria-busy', 'false');

  const datasets = [], facts = [], notes = [];
  const precipUnits = new Set();
  const bars = BAR_PAIRS.has(ids.join(','));
  const series = {hn24: hn24Series, hs24: hs24Series, hw24: hw24Series};
  // One precipitation series; centimetre (HN24/ΔHS) and millimetre (HW24) values get separate axes.
  function addPrecip(station, data, kind) {
    const precip = series[kind](data, from, to), name = station.name, color = station.color;
    if (!precip.latest) return;
    const unit = kind === 'hw24' ? 'mm' : 'cm', label = precip.method, axis = unit === 'mm' ? 'yMm' : 'yCm';
    precipUnits.add(unit);
    datasets.push(bars
      ? {type: 'bar', label: `${name} ${label}`, unit, kind: 'bar', data: precip.points, yAxisID: axis, order: 10,
          borderColor: color, backgroundColor: unit === 'mm' ? color + '30' : color + '99', borderWidth: unit === 'mm' ? 1 : 0,
          barPercentage: 0.95, categoryPercentage: 1, grouped: true}
      : {label: `${name} ${label}`, unit, kind: 'precip', data: precip.points, yAxisID: axis,
          borderColor: color, backgroundColor: color + '22', borderWidth: 1.6, borderDash: [7, 3], fill: 'origin', tension: 0.2});
    const sign = v => (kind === 'hs24' && v > 0 ? '+' : '');
    let fact = `${name} ${label} now **${sign(precip.latest.y)}${precip.latest.y.toFixed(1)} ${unit}**`;
    if (precip.peak && precip.peak.y > precip.latest.y) fact += `, peak **${sign(precip.peak.y)}${precip.peak.y.toFixed(1)} ${unit}** at ${when(precip.peak.x, hours)}`;
    facts.push(fact);
    if (precip.partial) notes.push(`${name}: some ${label} values unavailable (missing or rejected readings, or no baseline 24 h earlier).`);
  }
  results.forEach((result, i) => {
    const id = ids[i], station = host.stations[id], color = station.color;
    const name = station.name;
    if (result.status === 'rejected') {
      notes.push(`${name}: archive unavailable.`);
      view.retry.hidden = false;
      return;
    }
    const data = result.value;
    const temp = metricSeries(data, 'temperature', from, to);
    if (temp.points.some(p => p.y !== null)) {
      datasets.push({label: `${name} temp`, unit: '°C', kind: 'temp', data: temp.points, yAxisID: 'yTemp',
        borderColor: color, backgroundColor: color, borderWidth: 2.2, borderDash: [], tension: 0.2});
    } else notes.push(`${name}: no valid temperature.`);
    if (!host.hiddenWindIds.has(id)) {
      const wind = metricSeries(data, 'wind', from, to);
      if (wind.points.some(p => p.y !== null)) {
        datasets.push({label: `${name} wind`, unit: 'km/h', kind: 'wind', data: wind.points, yAxisID: 'yWind',
          borderColor: color, backgroundColor: color, borderWidth: 1.6, borderDash: [2, 3], tension: 0.2});
        const pk = peak(wind.points);
        if (pk) facts.push(`${name} peak wind **${pk.y.toFixed(0)} km/h** at ${when(pk.x, hours)}`);
      }
    }
    let kind = null;
    if (HS_PRECIP_IDS.has(id)) kind = bars ? 'hn24' : 'hs24';
    else if (!host.noPrecipGaugeIds.has(id)) kind = 'hw24';
    if (kind) addPrecip(station, data, kind);
  });

  extraResults.forEach((result, i) => {
    const station = host.stations[extras[i].id];
    if (result.status === 'fulfilled') addPrecip(station, result.value, extras[i].kind);
    else notes.push(`${station.name}: archive unavailable.`);
  });

  if (!datasets.length) {
    view.status.textContent = 'No usable data for this pair in the selected period.';
    return;
  }
  if (typeof window.Chart !== 'function') {
    view.status.textContent = 'Chart library unavailable. Reload the page to try again.';
    return;
  }
  // Legend: one entry per series, drawn as the same line style used on the chart.
  for (const d of datasets) {
    const item = element('span');
    const swatch = element('i', `pair-compare-swatch ${d.kind}`);
    swatch.style.borderColor = d.borderColor;
    if (d.kind === 'precip' || d.kind === 'bar') { swatch.style.background = d.backgroundColor; if (d.unit === 'mm' && d.kind === 'bar') swatch.style.borderStyle = 'solid'; }
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(`${d.label} (${d.unit})`));
    view.legend.append(item);
  }
  view.status.innerHTML = facts.map(f => f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')).join(' · ');
  view.note.textContent = [
    `Rolling ${ranges.find(r => r[0] === hours)[1]} ending ${clock.format(to)} MST.`,
    datasets.some(d => d.kind === 'bar')
      ? 'Solid = temperature, dotted = wind, bars = rolling 24 h totals at each reading (HN24 in cm, from the new-snow sensor or HS; HW24 in mm, from the precipitation gauge).'
      : 'Solid = temperature, dotted = wind, dashed/shaded = change in HS over the previous 24 h at each reading (cm; settlement is negative).',
    ...notes
  ].join(' ');
  view.chartBox.hidden = false;
  view.canvas.setAttribute('aria-label', `Temperature, wind and precipitation timing for ${ids.map(id => host.stations[id].name).join(' and ')}.`);
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--color-text-muted').trim();
  const grid = css.getPropertyValue('--color-divider').trim();
  const tick = {color: text, font: {size: 11}};
  const axisTitle = unit => [...new Set(datasets.filter(d => d.unit === unit && (d.kind === 'bar' || d.kind === 'precip')).map(d => d.label.split(' ').at(-1) === '24h' ? 'ΔHS 24h' : d.label.split(' ').at(-1)))].join(' / ') + ' ' + unit;
  const hasWind = datasets.some(d => d.kind === 'wind');
  view.chart = new window.Chart(view.canvas, {
    type: 'line',
    data: {datasets: datasets.map(d => ({...d, parsing: false, pointRadius: 0, pointHitRadius: 10, spanGaps: false, fill: d.fill || false}))},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: {mode: 'x', intersect: false},
      plugins: {legend: {display: false}, tooltip: {callbacks: {
        title: items => items.length ? `${clock.format(items[0].parsed.x)} MST` : '',
        label: c => `${c.dataset.label}: ${c.parsed.y?.toFixed(1)} ${c.dataset.unit}`
      }}},
      scales: {
        x: {type: 'time', min: from, max: to, offset: false, grid: {color: grid},
          // Ticks on fixed-MST boundaries (MST midnight = 07:00 UTC), independent of the viewer's time zone.
          afterBuildTicks: axis => {
            const step = (hours === 24 ? 6 : hours === 72 ? 12 : 24) * HOUR, offset = 7 * HOUR;
            const ticks = [];
            for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) ticks.push({value: t});
            axis.ticks = ticks;
          },
          ticks: {...tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
            callback: value => hours === 24 ? hourClock.format(value) : (hours === 72 ? `${dayClock.format(value)} ${hourClock.format(value)}` : dayClock.format(value))}},
        yTemp: {position: 'left', title: {display: true, text: '°C', color: text}, grid: {color: grid}, ticks: tick},
        yWind: {display: hasWind, position: 'right', beginAtZero: true, title: {display: true, text: 'km/h', color: text}, grid: {drawOnChartArea: false}, ticks: tick},
        yCm: {display: precipUnits.has('cm'), position: 'right', title: {display: true, text: axisTitle('cm'), color: text}, grid: {drawOnChartArea: false}, ticks: tick,
          suggestedMin: 0, suggestedMax: 2},
        yMm: {display: precipUnits.has('mm'), position: 'right', title: {display: true, text: axisTitle('mm'), color: text}, grid: {drawOnChartArea: false}, ticks: tick,
          suggestedMin: 0, suggestedMax: 2}
      }
    }
  });
}
function scan() {
  for (const [card, view] of mounted) if (!card.isConnected) { destroy(view); mounted.delete(card); }
  row.querySelectorAll('.kpi-pair[data-pair-ids]').forEach(card => { if (!mounted.has(card)) mount(card); });
}
if (host && row) {
  new MutationObserver(scan).observe(row, {childList: true});
  document.getElementById('refreshBtn')?.addEventListener('click', () => {
    requests.clear();
    for (const view of mounted.values()) if (view.state.open) render(view);
  });
  scan();
}
