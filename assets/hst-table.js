import {stormSnow, HST_LOOKBACK_H, STORM_GAP_H} from './hst.js';

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
  if (!r) { cell.textContent = '—'; cell.title = 'No snow-depth data'; return; }
  cell.append(document.createTextNode(`${r.partial && r.hst > 0 ? '≥' : ''}${r.hst.toFixed(1)} cm`));
  cell.title = r.hst === 0 ? (r.start ? `No hourly HN since the storm began, ${day.format(r.start)} MST` : `No storm: no precipitation in the last ${STORM_GAP_H} h`)
    : `Sum of the hourly HN since the storm began, ${r.start ? day.format(r.start) + ' MST' : 'at the start of the data'} (precipitation with no gap over ${STORM_GAP_H} h)`
      + (r.partial ? '. Some hours are missing or the storm began before the 10 days fetched, so this is a minimum.' : '');
}
function fill() {
  if (!host) return;
  for (const cell of document.querySelectorAll('[data-hst-id]')) {
    const id = cell.dataset.hstId;
    if (cell.dataset.hstDone === '1') continue;
    cell.dataset.hstDone = '1';
    cell.textContent = '…';
    // HST is never below the HN24 shown in the same row.
    const hn24 = Number(cell.dataset.hn24);
    records(id).then(data => { if (cell.isConnected) show(cell, stormSnow(data, Date.now(), {hn24})); })
      .catch(() => { if (cell.isConnected) { cell.textContent = '—'; cell.title = 'Archive unavailable'; } });
  }
}
window.fillHst = fill;
document.getElementById('refreshBtn')?.addEventListener('click', () => cache.clear());
fill();
