/* Snowpack radiation view for the station cards (Ben, 24 Nov 2026): the radiation that heats or cools the
   snowpack, in W/m2, at the stations that measure all four components (U Sask Peyto Moraine and Helen Creek).

   Each hourly record carries the hour's mean incoming and outgoing shortwave (swIn, swOut) and longwave
   (lwIn, lwOut), decoded in netlify/functions/_lrgs.mjs. The card plots
     Net shortwave = swIn - swOut   sunlight the snow absorbs (never below 0; the sensors read a few W/m2
                                    below zero at night, which is offset, not energy)
     Net longwave  = lwIn - lwOut   usually below 0: the snow radiating heat away, most on clear nights
     Net radiation = the two added  above 0 the snowpack gains heat, below 0 it loses heat
   Only hours with all four readings are plotted. Summed readings, so the view is tagged Raw.
   The longwave line is drawn on top so it stays visible at night, when the net line equals it. */

export const RADIATION_FIELDS = ['swIn', 'swOut', 'lwIn', 'lwOut'];

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** True when the records hold at least one hour with all four components. */
export function hasRadiation(records) {
  return (records || []).some((r) => RADIATION_FIELDS.every((f) => Number.isFinite(num(r[f]))));
}

/** Hourly net shortwave, net longwave and net radiation in [from, to], plus their means. */
export function radiationSeries(records, from, to) {
  const sw = [], lw = [], net = [];
  for (const r of records || []) {
    const t = new Date(r.measurementDateTime).getTime();
    if (!(t >= from && t <= to)) continue;
    const [si, so, li, lo] = RADIATION_FIELDS.map((f) => num(r[f]));
    if (![si, so, li, lo].every(Number.isFinite)) continue;
    const s = Math.max(0, Math.max(0, si) - Math.max(0, so));
    const l = li - lo;
    sw.push({ x: t, y: round1(s) });
    lw.push({ x: t, y: round1(l) });
    net.push({ x: t, y: round1(s + l) });
  }
  sw.sort((a, b) => a.x - b.x); lw.sort((a, b) => a.x - b.x); net.sort((a, b) => a.x - b.x);
  const mean = (pts) => (pts.length ? round1(pts.reduce((a, p) => a + p.y, 0) / pts.length) : null);
  return { sw, lw, net, meanSw: mean(sw), meanLw: mean(lw), meanNet: mean(net), hours: net.length };
}

function round1(v) { return Math.round(v * 10) / 10; }
const fmt = (v) => (v > 0 ? '+' : '') + v.toFixed(0);

/* Line colours: amber for sunlight, blue for longwave, and the page's text colour for the net line,
   which is drawn thickest. No red (Ben's rule for graphs). */
const COLORS = {
  light: { sw: '#c27c00', lw: '#2a78d6' },
  dark: { sw: '#e0a020', lw: '#5aa2f0' }
};

/** Chart.js config for a card (enlarged=false) or its enlarged view (no hover box, no hover dots). */
export function radiationChartConfig({ records, from, to, hours, fontSize = 11, enlarged = false, theme = 'light', text, grid, netColor, formatTime }) {
  const r = radiationSeries(records, from, to);
  const col = COLORS[theme === 'dark' ? 'dark' : 'light'];
  const tick = { color: text, font: { family: "'Courier Prime', monospace", size: fontSize } };
  const note = r.meanNet === null
    ? 'No radiation readings in this period'
    : `Avg net ${fmt(r.meanNet)} W/m² · sun ${fmt(r.meanSw)} · longwave ${fmt(r.meanLw)}`;
  const tooltip = enlarged ? { enabled: false } : {
    callbacks: {
      title: (items) => (formatTime ? formatTime(items[0].raw.x) : new Date(items[0].raw.x).toISOString()),
      label: (item) => `${item.dataset.label} ${item.raw.y.toFixed(0)} W/m²`
    }
  };
  const line = (label, data, color, width, extra = {}) => ({
    type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: width,
    pointRadius: 0, pointHoverRadius: enlarged ? 0 : 3, tension: 0.2, spanGaps: 3 * 3600000, ...extra
  });
  /* A solid line at 0 W/m2 so warming and cooling read at a glance. */
  const zeroLine = {
    id: 'radiationZero',
    beforeDatasetsDraw(chart) {
      const y = chart.scales.y, a = chart.chartArea;
      if (!y || !(y.min < 0 && y.max > 0)) return;
      const py = y.getPixelForValue(0), g = chart.ctx;
      g.save(); g.strokeStyle = text; g.globalAlpha = 0.55; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(a.left, py); g.lineTo(a.right, py); g.stroke(); g.restore();
    }
  };
  return {
    type: 'line',
    data: {
      datasets: [
        line('Net radiation', r.net, netColor || text, 3, { order: 2 }),
        line('Net shortwave (sun)', r.sw, col.sw, 2, { order: 1 }),
        line('Net longwave', r.lw, col.lw, 2, { order: 0, borderDash: [6, 3] })
      ]
    },
    plugins: [zeroLine],
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: text, font: { size: fontSize - 1 }, boxWidth: 14, boxHeight: 2, sort: (a, b) => a.datasetIndex - b.datasetIndex } },
        title: { display: true, text: note, color: text, font: { size: fontSize } },
        tooltip
      },
      scales: {
        x: { type: 'time', min: from, max: to, time: { unit: hours <= 48 ? 'hour' : 'day' }, ticks: tick, grid: { color: grid } },
        y: { ticks: tick, grid: { color: grid }, title: { display: true, text: 'W/m² (above 0 warms snow)', color: text } }
      }
    }
  };
}
