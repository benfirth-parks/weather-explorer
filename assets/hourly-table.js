/* Hourly readings table for one station (Ben, 18 Nov 2026): an enlarged station graph lists
   that station's raw hourly readings for the range on screen, newest first, and clicking the
   line marks that hour. Raw sensor values only; HW per hour comes from the same gauge
   intervals the graph draws (hwIntervals in assets/pair-comparison-data.js). */
export const HOUR = 3600000;
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
export function compass(deg) {
  const d = num(deg);
  return d === null ? null : DIRS[Math.floor((((d % 360) + 360) % 360 + 11.25) % 360 / 22.5)];
}
/* One row per clock hour between `from` and `to`, newest first. A row is the last reading in the
   hour ending at `hour` (start exclusive, end inclusive), so a station reporting on the hour gets
   one row per report. Hours with no reading stay in the list as gaps (`t: null`), except the hour
   still in progress. `hw` is a list of {start, end, y} gauge intervals; a row takes the interval
   its reading falls in. */
export function hourlyRows(records, from, to, hw = []) {
  const readings = (records || [])
    .map(r => ({r, t: new Date(r.measurementDateTime).getTime()}))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const rows = [];
  const lastHour = Math.ceil(to / HOUR) * HOUR;
  let i = 0;
  for (let hour = Math.floor(from / HOUR) * HOUR + HOUR; hour <= lastHour; hour += HOUR) {
    let pick = null;
    while (i < readings.length && readings[i].t <= hour) {
      if (readings[i].t > hour - HOUR) pick = readings[i];
      i++;
    }
    if (!pick) {
      if (hour <= to) rows.push({hour, t: null});
      continue;
    }
    const {r, t} = pick;
    const bin = hw.find(b => t > b.start && t <= b.end);
    rows.push({hour, t,
      temp: num(r.airTempAvg), rh: num(r.relativeHumidity),
      wind: num(r.windSpeedAvg), dir: num(r.windDirAvg), gust: num(r.windSpeedGust),
      hs: num(r.snowHeight), hw: bin ? num(bin.y) : null});
  }
  return rows.reverse();
}
/* The row for a clicked time: the one whose hour contains it, else the nearest. */
export function rowIndexAt(rows, t) {
  let best = -1, gap = Infinity;
  rows.forEach((row, i) => {
    if (t > row.hour - HOUR && t <= row.hour) { best = i; gap = -1; return; }
    const d = Math.abs(row.hour - t);
    if (gap >= 0 && d < gap) { best = i; gap = d; }
  });
  return best;
}
const fixed = n => v => v === null || v === undefined ? '–' : v.toFixed(n);
export const COLUMNS = [
  {key: 'temp', label: 'Temp', unit: '°C', text: fixed(1)},
  {key: 'rh', label: 'RH', unit: '%', text: fixed(0)},
  {key: 'wind', label: 'Wind', unit: 'km/h', text: fixed(0), group: 'wind'},
  {key: 'dir', label: 'Dir', unit: '', text: v => v === null || v === undefined ? '–' : `${compass(v)} ${Math.round(v)}°`, group: 'wind'},
  {key: 'gust', label: 'Gust', unit: 'km/h', text: fixed(0), group: 'wind'},
  {key: 'hs', label: 'HS', unit: 'cm', text: fixed(1), group: 'hs'},
  {key: 'hw', label: 'HW', unit: 'mm/h', text: fixed(1), group: 'hw'}
];
/* Columns to draw: those the station is allowed to show (`show.wind/hs/hw` false hides a group)
   and that hold at least one value in the range. */
export function activeColumns(rows, show = {}) {
  return COLUMNS.filter(c => show[c.group] !== false && rows.some(r => r[c.key] !== null && r[c.key] !== undefined));
}
/* Draws the table into `box`. `timeText(ms)` formats a time on the site clock. Returns the marked row. */
export function renderHourlyTable(box, {name, rangeLabel, rows, columns, selected, timeText, onClose}) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  box.replaceChildren();
  const head = el('div', 'hourly-table-head');
  const title = el('div', 'hourly-table-title');
  title.append(el('strong', '', name), document.createTextNode(` hourly readings · ${rangeLabel} · times MT, newest first`));
  const close = el('button', 'hourly-table-close', 'Hide table');
  close.type = 'button';
  close.addEventListener('click', onClose);
  head.append(title, close);
  const scroll = el('div', 'hourly-table-scroll');
  scroll.tabIndex = 0;
  let marked = null;
  if (!rows.some(r => r.t !== null) || !columns.length) {
    scroll.append(el('p', 'hourly-table-empty', 'No readings for this station in this period.'));
  } else {
    const table = el('table', 'hourly-table');
    const tr = el('tr');
    tr.append(el('th', '', 'Time'));
    for (const c of columns) { const th = el('th', '', c.label); if (c.unit) th.append(el('span', '', ` ${c.unit}`)); tr.append(th); }
    const thead = el('thead'); thead.append(tr);
    const tbody = el('tbody');
    rows.forEach((row, i) => {
      const line = el('tr', row.t === null ? 'hourly-gap' : '');
      line.append(el('th', '', timeText(row.t ?? row.hour)));
      if (row.t === null) { const td = el('td', '', 'No reading'); td.colSpan = columns.length; line.append(td); }
      else for (const c of columns) line.append(el('td', '', c.text(row[c.key])));
      if (i === selected) { line.classList.add('hourly-selected'); line.setAttribute('aria-selected', 'true'); marked = line; }
      tbody.append(line);
    });
    table.append(thead, tbody);
    scroll.append(table);
  }
  box.append(head, scroll);
  box.hidden = false;
  if (marked) scroll.scrollTop = Math.max(0, marked.offsetTop - scroll.clientHeight / 2);
  return marked;
}
