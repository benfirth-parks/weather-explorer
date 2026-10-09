import {stormSnow, HST_LOOKBACK_H, STORM_BREAK_H} from './hst.js';

/* Fills the HST cells of the 24 h station summary. HST needs more history than the table's 24 h
   window, so each station's last HST_LOOKBACK_H hours are fetched once and reused for 30 min. */
const host = window.weatherPairComparisonHost;
const cache = new Map();
const KEEP_MS = 30 * 60000;
const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Etc/GMT+7', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false});

function records(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const item = {at: Date.now(), promise: host.fetchRecords(id, HST_LOOKBACK_H + 6)};
  item.promise.catch(() => { if (cache.get(id) === item) cache.delete(id); });
  cache.set(id, item);
  return item.promise;
}
function show(cell, r) {
  cell.replaceChildren();
  if (!r) { cell.textContent = '—'; cell.title = 'No new-snow or snow-depth data'; return; }
  cell.append(document.createTextNode(`${r.partial && r.hst > 0 ? '≥' : ''}${r.hst.toFixed(1)} cm`));
  if (r.hst > 0 && !r.ongoing) {
    const note = document.createElement('span');
    note.className = 'hst-ended';
    note.textContent = ' ended';
    cell.append(note);
  }
  cell.title = r.hst === 0 ? `No new snow in the last ${HST_LOOKBACK_H / 24} days`
    : `Storm snow since ${day.format(r.start)} MST${r.ongoing ? ', storm ongoing' : `, storm ended ${day.format(r.end)} MST (${STORM_BREAK_H} h without new snow)`}`
      + (r.partial ? '. Some hours are missing or the storm began before the data shown, so this is a minimum.' : '');
}
function fill() {
  if (!host) return;
  for (const cell of document.querySelectorAll('[data-hst-id]')) {
    const id = cell.dataset.hstId;
    if (cell.dataset.hstDone === '1') continue;
    cell.dataset.hstDone = '1';
    cell.textContent = '…';
    records(id).then(data => { if (cell.isConnected) show(cell, stormSnow(data, Date.now())); })
      .catch(() => { if (cell.isConnected) { cell.textContent = '—'; cell.title = 'Archive unavailable'; } });
  }
}
window.fillHst = fill;
document.getElementById('refreshBtn')?.addEventListener('click', () => cache.clear());
fill();
