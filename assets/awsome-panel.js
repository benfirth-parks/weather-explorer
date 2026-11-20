import {dataKindTag} from './data-kind.js';
import {AWSOME_POINTS} from './awsome-data.js';

/* Today's SnowpackBC AWSOME "Dry" profile, drawn in the paired pane beside the study-plot profile the
   way the AWSOME site's profile view draws it: (1) hand-hardness bars coloured by grain type with the
   snow temperature, and (2) the same bars coloured by Punstable class with the Punstable curve.
   Colours and class breaks follow the AWSOME (nivix) viewer. All data text is inserted as text.
   ?awsome=off hides it. */
const NS = 'http://www.w3.org/2000/svg';
/* Grain colours: the ICSSG colours the Banff Snowpack profile beside these panels uses (assets/plot-profile.js),
   so one colour means one grain form across all three models. */
export const AWSOME_GRAIN = {
  PP: ['#00ff00', 'Precipitation particles'], DF: ['#228b22', 'Decomposing and fragmented'], RG: ['#ffb6c1', 'Rounded grains'],
  FC: ['#add8e6', 'Faceted crystals'], FCxr: ['#6495ed', 'Rounding faceted'], DH: ['#0000ff', 'Depth hoar'],
  SH: ['#ff00ff', 'Surface hoar'], MF: ['#ff0000', 'Melt forms'], MFcr: ['#8b0000', 'Melt-freeze crust'], IF: ['#00ffff', 'Ice formation']
};
const KEY_GRAINS = ['PP', 'DF', 'RG', 'FC', 'FCxr', 'DH', 'SH', 'MF', 'MFcr'];
/* Punstable classes (EAWS breaks used by the AWSOME viewer: 0.70, 0.78, 0.85). */
export const PU_CLASSES = [
  {max: 0.7, color: '#a2e05a', label: '< 0.70'},
  {max: 0.78, color: '#fff3a8', label: '0.70–0.78'},
  {max: 0.85, color: '#f0a04b', label: '0.78–0.85'},
  {max: Infinity, color: '#c9281f', label: '≥ 0.85'}
];
export const puClass = p => PU_CLASSES.find(c => p < c.max) || PU_CLASSES.at(-1);
const HARDNESS = ['', 'F', '4F', '1F', 'P', 'K', 'I'];
const TEMP_COLOR = '#d9472b', PU_COLOR = '#e8891c';
const clock = new Intl.DateTimeFormat('en-CA', {timeZone: 'Etc/GMT+6', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false});
const requests = new Map();
const MEMORY_MS = 10 * 60000;
const OFF = (() => { try { return new URLSearchParams(location.search).get('awsome') === 'off'; } catch { return false; } })();

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
function colors() {
  const css = getComputedStyle(document.documentElement);
  return {
    muted: css.getPropertyValue('--color-text-muted').trim() || '#888',
    grid: css.getPropertyValue('--color-divider').trim() || css.getPropertyValue('--color-border').trim() || '#ddd',
    ink: css.getPropertyValue('--color-text').trim() || '#222'
  };
}

function load(plot) {
  let item = requests.get(plot);
  if (!item || Date.now() - item.at > MEMORY_MS) {
    item = {at: Date.now()};
    item.promise = fetch(`/api/awsome?plot=${encodeURIComponent(plot)}`, {headers: {accept: 'application/json'}})
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .catch(error => { if (requests.get(plot) === item) requests.delete(plot); throw error; });
    requests.set(plot, item);
  }
  return item.promise;
}

/* One AWSOME Dry panel. Hardness runs I..F left to right along the top (bars grow from the right, fist
   side); the bottom axis is snow temperature (mode 'grain', -30..0 C) or Punstable (mode 'punstable', 1..0),
   both with zero on the right. */
function drawDry(data, mode, yMax) {
  const {muted, grid, ink} = colors();
  const layers = data.profile.layers;
  const W = 400, H = 356, m = {l: 40, r: 8, t: 26, b: 32};
  const pw = W - m.l - m.r, ph = H - m.t - m.b, x0 = m.l + pw;
  const y = cm => m.t + ph * (1 - cm / yMax);
  const xh = h => x0 - pw * Math.max(0, Math.min(6, h)) / 6;
  const svg = sv('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'plot-profile-svg awsome-dry',
    'aria-label': mode === 'grain'
      ? `AWSOME modelled profile at ${data.location}: hand hardness by grain type with snow temperature.`
      : `AWSOME modelled profile at ${data.location}: hand hardness coloured by Punstable class with the Punstable curve.`});
  const text = (tx, ty, s, attrs = {}) => sv('text', {x: tx, y: ty, 'text-anchor': 'middle', fill: muted, 'font-size': 10, ...attrs}, s);
  const line = (x1, x2, y1, y2, stroke = grid, extra = {}) => sv('line', {x1, x2, y1, y2, stroke, 'stroke-width': 0.7, ...extra});
  svg.append(text(m.l + pw / 2, 11, 'Hand hardness', {fill: ink, 'font-size': 11}));
  svg.append(text(m.l - 4, m.t - 6, 'cm', {'text-anchor': 'end'}));
  const step = yMax > 250 ? 50 : yMax > 120 ? 25 : yMax > 40 ? 20 : 10;
  for (let v = 0; v <= yMax; v += step) svg.append(line(m.l, x0, y(v), y(v), grid, {'stroke-dasharray': '2 3'}), text(m.l - 5, y(v) + 3.5, String(v), {'text-anchor': 'end'}));
  for (let i = 1; i <= 6; i++) svg.append(line(xh(i), xh(i), m.t, m.t + ph, grid, {'stroke-dasharray': '2 3'}), text(xh(i), m.t + 12, HARDNESS[i]));
  svg.append(sv('rect', {x: m.l, y: m.t, width: pw, height: ph, fill: 'none', stroke: grid}));
  for (const L of layers) {
    const [top, bot, g, pu, weak, h] = L;
    const yt = y(Math.min(top, yMax)), yb = y(Math.max(0, bot)), hh = Math.max(0.6, yb - yt);
    const xl = xh(Number.isFinite(h) ? h : 1);
    const fill = mode === 'grain' ? (AWSOME_GRAIN[g]?.[0] || '#999') : (pu === null ? '#2a2f38' : puClass(pu).color);
    const r = sv('rect', {x: xl, y: yt, width: Math.max(1, x0 - xl), height: hh, fill, stroke: weak && mode === 'grain' ? ink : 'none', 'stroke-width': weak && mode === 'grain' ? 1 : 0});
    const tip = [`${bot}–${top} cm`, g ? `${AWSOME_GRAIN[g]?.[1] || 'Unclassified'} (${g})` : 'grain not given', `hardness ${HARDNESS[Math.round(h)] || '?'}`];
    if (pu !== null) tip.push(`Punstable ${pu.toFixed(2)}`);
    if (Number.isFinite(L[6])) tip.push(`${L[6].toFixed(1)} °C`);
    if (weak) tip.push('persistent weak layer flag');
    r.append(sv('title', {}, tip.join(' · ')));
    svg.append(r);
  }
  // Bottom axis and curve, zero on the right.
  const pts = [];
  if (mode === 'grain') {
    const temps = layers.filter(l => Number.isFinite(l[6]));
    const tmin = Math.min(-30, Math.floor(Math.min(0, ...temps.map(l => l[6])) / 5) * 5);
    const xt = T => m.l + pw * (1 - T / tmin);
    for (let v = tmin; v <= 0; v += tmin < -30 ? 10 : 10) svg.append(text(xt(v), m.t + ph + 13, String(v), {fill: '#d9472b'}));
    svg.append(text(m.l + pw / 2, H - 6, 'Snow temperature / °C', {fill: '#d9472b', 'font-weight': 600}));
    for (const l of temps) pts.push([xt(l[6]), y((l[0] + l[1]) / 2)]);
    if (temps.length) pts.unshift([xt(temps[0][6]), y(0)]), pts.push([xt(temps.at(-1)[6]), y(temps.at(-1)[0])]);
    if (pts.length > 1) svg.append(sv('polyline', {points: pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: TEMP_COLOR, 'stroke-width': 2.2, 'stroke-linejoin': 'round'}));
  } else {
    const xp = p => m.l + pw * (1 - p);
    for (const v of [1, 0.75, 0.5, 0.25, 0]) svg.append(text(xp(v), m.t + ph + 13, String(v), {fill: PU_COLOR}));
    svg.append(text(m.l + pw / 2, H - 6, 'Punstable', {fill: PU_COLOR, 'font-weight': 600}));
    for (const l of layers) if (l[3] !== null) pts.push([xp(l[3]), y((l[0] + l[1]) / 2)]);
    if (pts.length > 1) svg.append(sv('polyline', {points: pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: PU_COLOR, 'stroke-width': 2, 'stroke-linejoin': 'round'}));
  }
  return svg;
}

function swatch(color, label, css) {
  const item = element('span'), sw = element('i');
  if (css) sw.style.cssText = css; else sw.style.background = color;
  sw.setAttribute('aria-hidden', 'true');
  item.append(sw, document.createTextNode(label));
  return item;
}
/* Legend for one panel, placed directly under it. */
function legend(mode) {
  const key = element('div', 'plot-profile-key awsome-key');
  if (mode === 'grain') {
    for (const g of KEY_GRAINS) key.append(swatch(AWSOME_GRAIN[g][0], `${g} ${AWSOME_GRAIN[g][1].toLowerCase()}`));
    key.append(swatch('', 'snow temperature', `background:${TEMP_COLOR};height:3px;border:0`),
      swatch('', 'outlined = persistent weak layer flag', 'background:transparent;border:1.5px solid var(--color-text)'));
  } else {
    for (const c of PU_CLASSES) key.append(swatch(c.color, `Punstable ${c.label}`));
    key.append(swatch('#2a2f38', 'no Punstable'), swatch('', 'Punstable curve', `background:${PU_COLOR};height:3px;border:0`));
  }
  return key;
}

/* A link to the model's own site on its own line at the foot of a panel's legend (kept inside the
   legend so the panels' caption / chart / legend rows still line up). */
export function withSiteLink(key, url) {
  const link = element('a', 'awsome-site-link', 'SnowpackBC AWSOME ↗');
  link.href = url; link.target = '_blank'; link.rel = 'noopener';
  link.title = 'Open the AWSOME model on snowpackbc.com';
  key.append(link);
  return key;
}

function figure(title, meta) {
  const fig = element('figure', 'plot-profile-fig awsome-fig');
  const cap = element('figcaption');
  cap.append(element('strong', '', title), dataKindTag('interp'), document.createTextNode(` · ${meta}`));
  const body = element('div', 'awsome-body');
  body.append(element('p', 'plot-profile-note', 'Loading AWSOME…'));
  fig.append(cap, body);
  return {fig, body, cap};
}

/* Height scale helpers. The pane (assets/plot-profile.js) puts the Banff modelled profile and both
   AWSOME panels of all three sites on one scale: the deepest snowpack among them, plus 10 %, rounded up
   to 10 cm. */
export const awsomeTop = d => Math.max(d?.profile?.hs || 0, ...(d?.profile?.layers || []).map(l => l[0]));
export const sharedScale = tops => Math.ceil(Math.max(20, ...tops.filter(Number.isFinite)) * 1.1 / 10) * 10;
export const loadAwsome = load;

/* Adds the two AWSOME Dry figures, each with its legend underneath, to the study-plot figure grid (`figs`),
   and the note after `noteHost`. `yMax` is the shared height scale in cm (own scale if not given). */
export function appendAwsome(figs, plot, noteHost, yMax) {
  if (OFF || !Object.hasOwn(AWSOME_POINTS, plot)) return;
  const point = AWSOME_POINTS[plot];
  const a = figure('AWSOME Dry', 'flat field');
  const b = figure('AWSOME Dry · Punstable', 'flat field');
  figs.append(a.fig, b.fig);
  const after = element('div', 'awsome-after');
  noteHost?.after(after);
  load(plot).then(data => {
    if (!figs.isConnected) return;
    const when = `${clock.format(data.t)} MT`;
    a.cap.lastChild.textContent = ` · ${when}${data.profile?.hs ? ` · HS ${Math.round(data.profile.hs)} cm` : ''}`;
    b.cap.lastChild.textContent = ` · ${when}`;
    const layers = data.profile?.layers || [];
    if (!layers.length) {
      a.body.replaceChildren(element('p', 'plot-profile-empty', 'AWSOME: no modelled snow at this time.'));
      b.fig.remove();
      return;
    }
    const scale = yMax > 0 ? yMax : sharedScale([awsomeTop(data)]);
    a.body.replaceChildren(drawDry(data, 'grain', scale), withSiteLink(legend('grain'), data.url));
    b.body.replaceChildren(drawDry(data, 'punstable', scale), withSiteLink(legend('punstable'), data.url));
    const link = element('a', '', 'open AWSOME');
    link.href = data.url; link.target = '_blank'; link.rel = 'noopener';
    const note = element('p', 'plot-profile-note');
    note.append(document.createTextNode(`AWSOME Dry profile (SnowpackBC, ${point.label}, flat field), drawn as on the AWSOME site. Punstable is the modelled probability that a layer is unstable (Mayer et al. 2022). ${point.elevation ? `Model point ${point.elevation} m. ` : ''}${data.stale ? 'SnowpackBC did not answer; showing the last copy read. ' : ''}${data.label} `), link);
    after.replaceChildren(note);
  }).catch(() => {
    if (!figs.isConnected) return;
    a.body.replaceChildren(element('p', 'plot-profile-empty', 'AWSOME profile unavailable right now.'));
    b.fig.remove();
  });
}
