/* Cleanout markers for the paired panes, read from the field Google Sheet.
   Each pair has its own tab (Bosworth pair -> Bosworth Lower tab). A day whose A/C box is ticked
   gets a red vertical line on the pane, labelled with that day's Cleanout selection. Shared by netlify/functions/cleanouts.mjs and the tests. */
export const SHEET_ID = '1TkF0B3e_q7xWB2x91FG7x4LY_GTqBEI2HYvacLu3aDM';
/* Pair (station ids joined by ",") -> words that pick its tab, plus a known gid to fall back on. */
export const PAIR_TABS = {
  'fts-bosup,fts-boslo': {match: ['bosworth'], gid: '394237732'},
  'fts-vulture,fts-bowsummit': {match: ['bow summit', 'vulture']},
  'fts-simpup,fts-simplo': {match: ['simpson']},
  'fts-lookout,fts-sunshine': {match: ['sunshine', 'lookout']},
  'fts-whymper,fts-stanley': {match: ['stanley', 'whymper']}
};
const MST_OFFSET_MS = 7 * 3600000;

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Tab names and gids from the sheet's htmlview page. */
export function parseTabs(html) {
  const tabs = [];
  const re = /name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g;
  for (let m; (m = re.exec(html));) tabs.push({name: JSON.parse(`"${m[1]}"`), gid: m[2]});
  return tabs;
}

export function tabForPair(pair, tabs) {
  const spec = PAIR_TABS[pair];
  if (!spec) return null;
  for (const word of spec.match) {
    const tab = tabs.find(t => t.name.toLowerCase().includes(word));
    if (tab) return tab;
  }
  return spec.gid ? {name: null, gid: spec.gid} : null;
}

const checked = v => /^(true|yes|y|x|✓|✔|1)$/i.test(String(v).trim());
const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};

/* A sheet date (and optional time) in MST -> epoch ms, or null. A date with no time is placed at 08:00, the morning study plot observation. */
export function parseWhen(dateText, timeText = '') {
  const s = String(dateText).trim();
  let y, mo, d, rest = '';
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/))) [, y, mo, d, rest] = m;
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/))) [, mo, d, y, rest] = m;
  else if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})(.*)$/))) { [, d, mo, y, rest] = m; mo = MONTHS[mo.toLowerCase()]; }
  else if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(.*)$/))) { [, mo, d, y, rest] = m; mo = MONTHS[mo.toLowerCase()]; }
  else return null;
  y = +y; if (y < 100) y += 2000;
  if (!mo || !+d) return null;
  const t = (String(timeText).trim() || rest.trim()).match(/^(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  let h = 8, min = 0;
  if (t && (t[2] !== undefined || t[3])) {
    h = +t[1]; min = +(t[2] || 0);
    if (t[3]) { const pm = /p/i.test(t[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  } else if (t && String(timeText).trim() && /^\d{3,4}$/.test(String(timeText).trim())) {
    const n = String(timeText).trim().padStart(4, '0'); h = +n.slice(0, 2); min = +n.slice(2);
  }
  if (h > 23 || min > 59) return null;
  return Date.UTC(y, +mo - 1, +d, h, min) + MST_OFFSET_MS;
}

/* Cleanout rows from one tab's CSV: [{t, label}] sorted by time.
   Each tab holds side-by-side month blocks: Date | HN 24 | Accum. HN 24 (cm) | A/C | Cleanout.
   A ticked A/C box marks the row; the label is that block's Cleanout cell. */
export function cleanoutsFromCsv(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex(r => r.some(c => /^a\/?c$/i.test(c.trim())));
  if (hi < 0) return {markers: [], columns: null};
  const head = rows[hi].map(c => c.trim());
  const blocks = [];
  head.forEach((c, i) => {
    if (!/^a\/?c$/i.test(c)) return;
    const prev = blocks.length ? blocks[blocks.length - 1].clean : -1;
    const clean = head.findIndex((h, j) => j > i && /clean/i.test(h));
    blocks.push({ac: i, from: prev + 1, clean: clean > i && clean <= i + 2 ? clean : -1});
  });
  const markers = [];
  for (const r of rows.slice(hi + 1)) {
    for (const b of blocks) {
      if (!checked(r[b.ac] ?? '')) continue;
      // The date is the block's first cell that reads as a date.
      let t = null;
      for (let j = b.from; j < b.ac && t === null; j++) t = parseWhen(r[j] ?? '');
      if (t === null) continue;
      const cell = b.clean >= 0 ? (r[b.clean] || '').trim() : '';
      const label = !cell || /^false$/i.test(cell) ? 'A/C' : /^true$/i.test(cell) ? 'Cleanout' : cell;
      markers.push({t, label});
    }
  }
  markers.sort((a, b) => a.t - b.t);
  return {markers, columns: {header: hi + 1, blocks: blocks.map(b => ({ac: b.ac, cleanout: b.clean}))}};
}
