import {dataKindTag} from './data-kind.js';
import {AWSOME_POINTS, PUNSTABLE_THRESHOLD} from './awsome-data.js';

/* Today's SnowpackBC AWSOME stability snapshot, drawn in the paired pane beside the study-plot profile:
   (1) the flat-field layers with each layer's Punstable, and (2) the most unstable layer on each aspect.
   All data text is inserted as text, never as HTML. ?awsome=off hides it. */
const NS = 'http://www.w3.org/2000/svg';
const GRAIN = {PP: '#00ff00', DF: '#228b22', RG: '#ffb6c1', FC: '#add8e6', FCxr: '#6495ed', DH: '#0000ff', SH: '#ff00ff', MF: '#ff0000', MFcr: '#8b0000', IF: '#00ffff'};
const DARK_GRAINS = new Set(['DF', 'DH', 'MFcr', 'FCxr']);
const NAMES = {PP: 'new snow', DF: 'decomposing', RG: 'rounds', FC: 'facets', FCxr: 'rounding facets', DH: 'depth hoar', SH: 'surface hoar', MF: 'melt forms', MFcr: 'melt-freeze crust'};
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
    ink: css.getPropertyValue('--color-text').trim() || '#222',
    surface: css.getPropertyValue('--color-surface').trim() || 'transparent'
  };
}
/* Punstable colour ramp: pale below 0.4, orange to red at the 0.77 threshold, dark red above. */
export function puColor(p) {
  const stops = [[0, [205, 214, 222]], [0.4, [247, 201, 140]], [0.6, [236, 135, 84]], [0.77, [194, 54, 43]], [1, [120, 16, 16]]];
  const v = Math.max(0, Math.min(1, Number(p) || 0));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i], t = (v - p0) / (p1 - p0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(120,16,16)';
}
const textOn = p => (p >= 0.6 ? '#fff' : '#1b2430');

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

/* Flat-field layers (grain column) with a Punstable bar per layer and the 0.77 line. */
function drawLayers(data) {
  const {muted, grid, ink} = colors();
  const prof = data.profile, layers = prof.layers;
  const W = 400, H = 340, m = {l: 40, r: 12, t: 10, b: 32}, colW = 54, gap = 14;
  const bx = m.l + colW + gap, bw = W - bx - m.r;
  const hs = Math.max(prof.hs || 0, ...layers.map(l => l[0]));
  const yMax = Math.ceil(Math.max(20, hs) * 1.08 / 10) * 10;
  const y = cm => m.t + (H - m.t - m.b) * (1 - cm / yMax);
  const x = p => bx + bw * p;
  const svg = sv('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'plot-profile-svg',
    'aria-label': `AWSOME flat-field layers at ${data.location} with probability of instability per layer.`});
  const tick = (tx, ty, text, anchor = 'middle', fill = muted) => sv('text', {x: tx, y: ty, 'text-anchor': anchor, fill, 'font-size': 10}, text);
  const step = yMax > 120 ? 25 : yMax > 40 ? 10 : 5;
  for (let v = 0; v <= yMax; v += step) svg.append(sv('line', {x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: grid, 'stroke-width': 0.7}), tick(m.l - 5, y(v) + 3.5, String(v), 'end'));
  for (const v of [0, 0.25, 0.5, 0.75, 1]) svg.append(tick(x(v), H - m.b + 12, String(v)));
  svg.append(tick(bx + bw / 2, H - 4, 'Punstable (probability unstable)'));
  svg.append(sv('text', {x: 10, y: m.t, transform: `rotate(-90 10 ${m.t})`, 'text-anchor': 'end', fill: muted, 'font-size': 10}, 'height (cm)'));
  let worst = -1;
  layers.forEach((l, j) => { if (l[3] !== null && (worst < 0 || l[3] > layers[worst][3])) worst = j; });
  layers.forEach((l, j) => {
    const [top, bot, g, pu, weak] = l;
    const yt = y(top), yb = y(bot), hh = Math.max(0.6, yb - yt - (yb - yt > 3 ? 1 : 0));
    const cell = sv('rect', {x: m.l, y: yt, width: colW, height: hh, fill: GRAIN[g] || '#9a9a9a', stroke: weak ? ink : 'none', 'stroke-width': weak ? 1.2 : 0});
    cell.append(sv('title', {}, `${bot}–${top} cm · ${g || 'unclassified'}${NAMES[g] ? ` (${NAMES[g]})` : ''}${weak ? ' · persistent weak layer flag' : ''}${pu !== null ? ` · Punstable ${pu.toFixed(2)}` : ''}`));
    svg.append(cell);
    if (hh > 9 && g) svg.append(tick(m.l + colW / 2, yt + hh / 2 + 3.5, g, 'middle', DARK_GRAINS.has(g) ? '#fff' : '#1b2430'));
    if (pu !== null) {
      const bar = sv('rect', {x: bx, y: yt, width: Math.max(1, bw * pu), height: hh, fill: puColor(pu), 'fill-opacity': j === worst ? 1 : 0.75, stroke: j === worst ? ink : 'none', 'stroke-width': j === worst ? 1 : 0});
      bar.append(sv('title', {}, `Punstable ${pu.toFixed(2)} at ${bot}–${top} cm (${g || 'unclassified'})`));
      svg.append(bar);
    }
  });
  svg.append(sv('line', {x1: x(PUNSTABLE_THRESHOLD), x2: x(PUNSTABLE_THRESHOLD), y1: m.t, y2: H - m.b, stroke: puColor(0.77), 'stroke-dasharray': '4 3', 'stroke-width': 1.2}));
  svg.append(tick(x(PUNSTABLE_THRESHOLD) + 3, m.t + 9, '0.77', 'start', puColor(0.77)));
  if (worst >= 0) {
    const [top, bot, g, pu] = layers[worst];
    const lx = Math.min(x(pu) + 5, W - m.r - 60);
    svg.append(tick(lx, y((top + bot) / 2) + 3.5, `${pu.toFixed(2)} ${g || ''}`, 'start', ink));
  }
  return svg;
}

/* Aspect rose: N/E/S/W sectors (38 deg slopes) around the flat field, coloured by Punstable. */
function drawRose(data) {
  const {muted, ink, surface} = colors();
  const W = 400, H = 340, cx = W / 2, cy = 150, R = 128, r = 46;
  const svg = sv('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'plot-profile-svg',
    'aria-label': `Most unstable layer by aspect at ${data.location}.`});
  const pt = (a, rad) => [cx + rad * Math.cos(a * Math.PI / 180), cy + rad * Math.sin(a * Math.PI / 180)];
  const label = (tx, ty, lines, fill) => lines.forEach(([text, size, weight], i) =>
    svg.append(sv('text', {x: tx, y: ty + i * (size + 3), 'text-anchor': 'middle', fill, 'font-size': size, 'font-weight': weight || 400}, text)));
  for (const [k, a0, a1] of [['N', -135, -45], ['E', -45, 45], ['S', 45, 135], ['W', 135, 225]]) {
    const v = data.aspects[k];
    const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
    const path = sv('path', {d: `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 0 0 ${x3},${y3} Z`,
      fill: v ? puColor(v.pu) : 'none', stroke: surface || ink, 'stroke-width': 3});
    path.append(sv('title', {}, v ? `${k} aspect: Punstable ${v.pu.toFixed(2)}, ${v.grain || 'unclassified'} ${Math.round(v.depth)} cm below the surface` : `${k} aspect: no unstable layer reported`));
    svg.append(path);
    const [tx, ty] = pt((a0 + a1) / 2, (R + r) / 2);
    const fill = v ? textOn(v.pu) : muted;
    label(tx, ty - 16, v ? [[k, 12, 700], [v.pu.toFixed(2), 15], [`${v.grain || ''} ${Math.round(v.depth)} cm`, 10]] : [[k, 12, 700], ['–', 15]], fill);
  }
  const f = data.aspects.F;
  svg.append(sv('circle', {cx, cy, r: r - 5, fill: f ? puColor(f.pu) : 'none', stroke: muted, 'stroke-width': 0.7}));
  label(cx, cy - 12, f ? [['Flat', 10], [f.pu.toFixed(2), 13], [`${f.grain || ''} ${Math.round(f.depth)} cm`, 9]] : [['Flat', 10], ['–', 13]], f ? textOn(f.pu) : muted);
  // Scale
  const sx = 70, sw = W - 140, sy = H - 34;
  for (let i = 0; i < 50; i++) svg.append(sv('rect', {x: sx + i * sw / 50, y: sy, width: sw / 50 + 0.5, height: 8, fill: puColor(i / 49)}));
  for (const v of [0, 0.5, 0.77, 1]) svg.append(sv('text', {x: sx + v * sw, y: sy + 20, 'text-anchor': 'middle', fill: v === 0.77 ? puColor(0.77) : muted, 'font-size': 10}, String(v)));
  svg.append(sv('text', {x: cx, y: H - 2, 'text-anchor': 'middle', fill: muted, 'font-size': 10}, 'Punstable of the most unstable layer · depth below surface'));
  return svg;
}

function figure(title, meta) {
  const fig = element('figure', 'plot-profile-fig awsome-fig');
  const cap = element('figcaption');
  cap.append(element('strong', '', title), dataKindTag('interp'), document.createTextNode(` · ${meta}`));
  const body = element('div', 'awsome-body');
  body.append(element('p', 'plot-profile-note', 'Loading AWSOME snapshot…'));
  fig.append(cap, body);
  return {fig, body, cap};
}

/* Adds the two AWSOME figures to the study-plot figure grid (`figs`) and a note after it (`noteHost`). */
export function appendAwsome(figs, plot, noteHost) {
  if (OFF || !Object.hasOwn(AWSOME_POINTS, plot)) return;
  const point = AWSOME_POINTS[plot];
  const a = figure('AWSOME today', `${point.label}, flat field`);
  const b = figure('Most unstable layer by aspect', 'AWSOME, 38° slopes');
  figs.append(a.fig, b.fig);
  const note = element('p', 'plot-profile-note');
  noteHost?.after(note);
  load(plot).then(data => {
    if (!figs.isConnected) return;
    const when = `${clock.format(data.t)} MT`;
    a.cap.lastChild.textContent = ` · ${point.label} · ${when}${data.weather?.hs ? ` · HS ${Math.round(data.weather.hs)} cm` : ''}`;
    if (data.profile && data.profile.layers.length) a.body.replaceChildren(drawLayers(data));
    else a.body.replaceChildren(element('p', 'plot-profile-empty', 'No modelled layers at this time.'));
    if (Object.values(data.aspects).some(Boolean)) b.body.replaceChildren(drawRose(data));
    else b.body.replaceChildren(element('p', 'plot-profile-empty', 'No aspect results at this time.'));
    const link = element('a', '', 'open AWSOME');
    link.href = data.url; link.target = '_blank'; link.rel = 'noopener';
    note.replaceChildren(document.createTextNode(`AWSOME (SnowpackBC): Punstable is the modelled probability that a layer is unstable (Mayer et al. 2022); 0.77 is the usual threshold. Outlined cells are persistent weak layer flags. ${point.elevation ? `Model point ${point.elevation} m. ` : ''}${data.stale ? 'SnowpackBC did not answer; showing the last copy read. ' : ''}${data.label} `), link);
  }).catch(() => {
    if (!figs.isConnected) return;
    a.body.replaceChildren(element('p', 'plot-profile-empty', 'AWSOME snapshot unavailable right now.'));
    b.fig.remove();
  });
}
