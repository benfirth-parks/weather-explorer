import {PAIR_PLOTS, PIT_MAX_AGE_DAYS, HARDNESS, simTemps, hardnessLabel, ageDays, pitIsCurrent} from './plot-profile-data.js';

/* Study-plot snow profile panel inside an expanded pair card: the latest simulated profile from the
   Banff Snowpack site and, beside it, the latest observed pit when it is under PIT_MAX_AGE_DAYS old.
   Each profile is hand-hardness bars by height above ground plus a temperature trace in its own panel,
   drawn as in the Banff Snowpack site. All data text is inserted as text, never as HTML. */
const NS = 'http://www.w3.org/2000/svg';
/* ICSSG grain-form colours, as on the Banff Snowpack site. */
const GRAIN = {
  PP: ['#00ff00', 'Precipitation particles'], PPgp: ['#808080', 'Graupel'], MM: ['#ffd700', 'Machine-made'],
  DF: ['#228b22', 'Decomposing and fragmented'], RG: ['#ffb6c1', 'Rounded grains'],
  FC: ['#add8e6', 'Faceted crystals'], FCxr: ['#6495ed', 'Rounding faceted'], DH: ['#0000ff', 'Depth hoar'],
  SH: ['#ff00ff', 'Surface hoar'], MF: ['#ff0000', 'Melt forms'], MFcr: ['#8b0000', 'Melt-freeze crust'],
  IF: ['#00ffff', 'Ice formation']
};
const KEY_GRAINS = ['PP', 'DF', 'RG', 'FC', 'FCxr', 'DH', 'SH', 'MF', 'MFcr'];
const TEMP_COLOR = '#d9472b';
const clock = new Intl.DateTimeFormat('en-CA', {timeZone: 'Etc/GMT+7', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false});
const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Etc/GMT+7', year: 'numeric', month: 'short', day: 'numeric'});
const requests = new Map();
const MEMORY_MS = 10 * 60000;

const grainOf = g => GRAIN[g] || GRAIN[String(g || '').slice(0, 2)] || null;
const grainColor = g => grainOf(g)?.[0] || '#9a9a9a';
const grainName = g => (g ? `${grainOf(g)?.[1] || 'Unclassified'} (${g})` : 'Grain form not recorded');
function sv(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function age(t) {
  const d = ageDays(t);
  if (d === null) return '';
  if (d < 1) return `${Math.max(0, Math.round(d * 24))} h ago`;
  return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago`;
}

/* Data source: invented profiles (assets/plot-profile-mock.js) until MOCK_UNTIL, while the plots
   have no snow, then /api/plot-profile. ?plotprofiles=mock or =live forces one; =off hides the panel. */
const MOCK_UNTIL = Date.UTC(2026, 10, 1, 7); // 1 Nov 2026, 00:00 MST
const MODE = (() => {
  let asked = null;
  try { asked = new URLSearchParams(location.search).get('plotprofiles'); } catch {}
  if (asked === 'mock' || asked === 'live' || asked === 'off') return asked;
  return Date.now() < MOCK_UNTIL ? 'mock' : 'live';
})();
export function plotForPair(ids) {
  if (MODE === 'off') return null;
  return PAIR_PLOTS[ids.join(',')] || null;
}

function load(plot, fresh) {
  if (MODE === 'mock') return import('./plot-profile-mock.js').then(m => m.mockPlotProfile(plot) || Promise.reject(new Error('no mock')));
  let item = requests.get(plot);
  if (fresh || !item || Date.now() - item.at > MEMORY_MS) {
    item = {at: Date.now()};
    item.promise = fetch(`/api/plot-profile?plot=${encodeURIComponent(plot)}`, {headers: {accept: 'application/json'}})
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .catch(error => { if (requests.get(plot) === item) requests.delete(plot); throw error; });
    requests.set(plot, item);
  }
  return item.promise;
}

/* One profile as an SVG: hardness bars (left) and temperature (right) on a shared height axis. */
function drawProfile({layers, temps, tests, hsMax, aria, observed}) {
  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue('--color-text-muted').trim() || '#666';
  const grid = css.getPropertyValue('--color-divider').trim() || css.getPropertyValue('--color-border').trim() || '#ddd';
  const ink = css.getPropertyValue('--color-text').trim() || '#222';
  const W = 400, H = 340, m = {l: 40, r: 8, t: 10, b: 32};
  const tempW = 92, gap = 14, hw = W - m.l - m.r - tempW - gap;
  const svg = sv('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria, class: 'plot-profile-svg'});
  const yMax = hsMax > 0 ? hsMax : 100;
  const y = cm => m.t + (H - m.t - m.b) * (1 - cm / yMax);
  const x0 = m.l + hw; // fist side on the right, harder to the left
  const xh = h => x0 - hw * Math.max(0, Math.min(6, h)) / 6;
  const tick = (x, yy, text, anchor = 'middle') => sv('text', {x, y: yy, 'text-anchor': anchor, fill: muted, 'font-size': 10}, text);
  const line = (x1, x2, y1, y2, stroke = grid, width = 0.7) => sv('line', {x1, x2, y1, y2, stroke, 'stroke-width': width});
  const step = yMax > 250 ? 50 : yMax > 120 ? 25 : yMax > 40 ? 20 : 10;
  for (let v = 0; v <= yMax; v += step) {
    svg.append(line(m.l, x0, y(v), y(v)), tick(m.l - 5, y(v) + 3.5, String(v), 'end'));
  }
  for (let i = 1; i <= 6; i++) svg.append(line(xh(i), xh(i), m.t, H - m.b), tick(xh(i), H - m.b + 12, HARDNESS[i]));
  svg.append(line(m.l, x0, y(0), y(0), muted, 1));
  svg.append(tick(m.l + hw / 2, H - 4, 'hand hardness'));
  svg.append(sv('text', {x: 10, y: m.t, transform: `rotate(-90 10 ${m.t})`, 'text-anchor': 'end', fill: muted, 'font-size': 10}, 'height (cm)'));
  for (const L of layers) {
    const [top, bot, g, h, rho, T, w, f] = L;
    const yt = y(Math.min(top, yMax)), yb = y(Math.max(0, bot));
    const hh = Math.max(0.6, yb - yt - (yb - yt > 3 ? 1 : 0));
    const xl = xh(Number.isFinite(h) ? h : 1), wd = Math.max(1, x0 - xl), r = Math.min(3, hh / 2, wd / 2);
    const path = sv('path', {d: `M${x0},${yt} H${xl + r} Q${xl},${yt} ${xl},${yt + r} V${yt + hh - r} Q${xl},${yt + hh} ${xl + r},${yt + hh} H${x0} Z`,
      fill: grainColor(g), 'fill-opacity': Number.isFinite(h) ? 0.95 : 0.45, stroke: f & 2 ? ink : 'none', 'stroke-width': f & 2 ? 1.2 : 0});
    const tip = [`${top}–${bot} cm`, grainName(g), `hardness ${hardnessLabel(h)}`];
    if (Number.isFinite(rho)) tip.push(`${rho} kg/m³`);
    if (!observed && Number.isFinite(T)) tip.push(`${T} °C`);
    if (!observed && w) tip.push(`${w}% liquid water`);
    if (f & 1) tip.push('melt-freeze crust');
    if (f & 2) tip.push('candidate weak layer (grain-form flag, not stability)');
    path.append(sv('title', {}, tip.join(' · ')));
    svg.append(path);
  }
  for (const t of tests || []) {
    const ty = y(t.height_cm), g = sv('g', {});
    g.append(line(x0 - 3, x0 + 7, ty, ty, ink, 2));
    g.append(sv('title', {}, `${[t.result || t.type, t.fracture_character].filter(Boolean).join(' ') || 'test'} at ${t.height_cm} cm`));
    svg.append(g);
  }
  // Temperature in its own panel (0 °C on the right), so there is no dual axis over the bars.
  const tx0 = x0 + gap, list = temps.filter(p => p[0] <= yMax + 1);
  const tmin = Math.min(-10, Math.floor(Math.min(0, ...list.map(p => p[1])) / 5) * 5);
  const xt = T => tx0 + tempW * (1 - Math.min(0, Math.max(tmin, T)) / tmin);
  for (let v = 0; v >= tmin; v -= tmin <= -20 ? 10 : 5) svg.append(line(xt(v), xt(v), m.t, H - m.b), tick(xt(v), H - m.b + 12, String(v)));
  svg.append(line(tx0, tx0 + tempW, y(0), y(0), muted, 1));
  svg.append(tick(tx0 + tempW / 2, H - 4, 'temp (°C)'));
  if (list.length > 1) {
    const pts = list.slice().sort((a, b) => a[0] - b[0]).map(p => `${xt(p[1]).toFixed(1)},${y(p[0]).toFixed(1)}`).join(' ');
    svg.append(sv('polyline', {points: pts, fill: 'none', stroke: TEMP_COLOR, 'stroke-width': 2, 'stroke-linejoin': 'round'}));
  }
  if (observed) for (const p of list) svg.append(sv('circle', {cx: xt(p[1]), cy: y(p[0]), r: 3, fill: TEMP_COLOR}));
  if (!list.length) svg.append(tick(tx0 + tempW / 2, m.t + 14, 'no temps'));
  return svg;
}

function figure(title, meta, svg) {
  const fig = element('figure', 'plot-profile-fig');
  const cap = element('figcaption');
  cap.append(element('strong', '', title), document.createTextNode(` · ${meta}`));
  fig.append(cap, svg);
  return fig;
}

function draw(box, data) {
  box.replaceChildren();
  const head = element('div', 'plot-profile-head');
  head.append(element('strong', '', `${data.name} study plot snowpack`));
  const elev = Number.isFinite(data.elevation) ? ` · ${data.elevation} m` : '';
  head.append(document.createTextNode(`${elev} · from the Banff Snowpack site · `));
  const link = element('a', '', 'open full season');
  link.href = data.url; link.target = '_blank'; link.rel = 'noopener';
  head.append(link);
  box.append(head);
  if (data.mock) box.append(element('p', 'plot-profile-mock', 'MOCK DATA: invented profiles for previewing this panel'));
  const sim = data.sim, pit = data.pit;
  const showPit = pit && pit.layers.length && pitIsCurrent(pit);
  const hsMax = Math.ceil(Math.max(20, sim?.hs || 0, showPit ? pit.hs || pit.layers[0]?.[0] || 0 : 0) * 1.08 / 10) * 10;
  const figs = element('div', 'plot-profile-figs');
  if (sim && sim.layers.length) {
    figs.append(figure('Modelled', `${clock.format(sim.t)} MST · HS ${Math.round(sim.hs ?? sim.layers[0][0])} cm`, drawProfile({
      layers: sim.layers, temps: simTemps(sim.layers), hsMax, observed: false,
      aria: `Modelled snow profile at ${data.name} study plot, ${clock.format(sim.t)} MST: ${sim.layers.length} layers, ${Math.round(sim.hs ?? sim.layers[0][0])} cm deep.`
    })));
  } else {
    figs.append(element('p', 'plot-profile-empty', sim ? `Modelled: no snow on the ground at ${clock.format(sim.t)} MST.` : 'Modelled: no profile published yet this season.'));
  }
  if (showPit) {
    figs.append(figure('Observed pit', `${clock.format(pit.t)} MST (${age(pit.t)})${pit.hs ? ` · HS ${pit.hs} cm` : ''}`, drawProfile({
      layers: pit.layers, temps: pit.temps, tests: pit.tests, hsMax, observed: true,
      aria: `Observed snow profile at ${data.name} study plot, ${clock.format(pit.t)} MST: ${pit.layers.length} layers.`
    })));
  }
  box.append(figs);
  const drawn = figs.querySelector('svg') !== null;
  const key = element('div', 'plot-profile-key');
  for (const g of KEY_GRAINS) {
    const item = element('span'), sw = element('i');
    sw.style.background = grainColor(g);
    sw.setAttribute('aria-hidden', 'true');
    item.append(sw, document.createTextNode(`${g} ${GRAIN[g][1].toLowerCase()}`));
    key.append(item);
  }
  if (drawn) box.append(key);
  const notes = drawn ? ['Bars = hand hardness by layer, coloured by grain form; outlined bars are candidate weak layers (grain-form flag, not stability). Hover a layer for details.'] : [];
  if (showPit) {
    if (pit.source === 'transcribed') notes.push('The pit was transcribed from a scanned profile.');
    const s = pit.score;
    if (s && (s.grainAgreement !== null || s.hardnessMae !== null)) {
      const parts = [];
      if (s.grainAgreement !== null) parts.push(`grain class agrees over ${Math.round(s.grainAgreement * 100)}% of the depth`);
      if (s.hardnessMae !== null) parts.push(`hardness differs by ${s.hardnessMae.toFixed(1)} steps on average`);
      if (s.hsDiff !== null) parts.push(`modelled HS is ${Math.abs(Math.round(s.hsDiff))} cm ${s.hsDiff >= 0 ? 'deeper' : 'shallower'}`);
      notes.push(`Model vs pit: ${parts.join(', ')}.`);
    }
  } else if (pit && pit.t) {
    notes.push(`No pit in the last ${PIT_MAX_AGE_DAYS} days; the latest observed was ${day.format(pit.t)}.`);
  } else {
    notes.push(`No observed pit published yet for the ${data.season || 'current'} season.`);
  }
  if (data.stale) notes.push('The Banff Snowpack site did not answer; showing the last copy read.');
  notes.push(data.label || 'Experimental snowpack-structure simulation, not an avalanche forecast.');
  box.append(element('p', 'plot-profile-note', notes.join(' ')));
}

/* Loads and draws the plot profile into `box`. `isCurrent` lets the caller drop a late answer. */
export async function renderPlotProfile(box, plot, {fresh = false, isCurrent = () => true} = {}) {
  box.hidden = false;
  box.setAttribute('aria-busy', 'true');
  box.replaceChildren(element('p', 'plot-profile-note', 'Loading study plot snowpack…'));
  try {
    const data = await load(plot, fresh);
    if (!isCurrent()) return;
    draw(box, data);
  } catch (error) {
    if (!isCurrent()) return;
    box.replaceChildren(element('p', 'plot-profile-note', 'Study plot snowpack unavailable right now.'));
  } finally {
    box.setAttribute('aria-busy', 'false');
  }
}
