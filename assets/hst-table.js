import {stormSnow, stormPrecip, HST_LOOKBACK_H, STORM_BREAK_H, STORM_BREAK_CM} from './hst.js';
import {HN_FROM_PRECIP_IDS} from './snow-stations.js';

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
function show(cell, r, source = 'snow') {
  const gauge = source === 'gauge';
  cell.replaceChildren();
  if (!r) { cell.textContent = '—'; cell.title = gauge ? 'No precipitation gauge data' : 'No new-snow or snow-depth data'; return; }
  cell.append(document.createTextNode(`${r.partial && r.hst > 0 ? '≥' : ''}${r.hst.toFixed(1)} cm`));
  cell.title = r.hst === 0 ? `No storm: under ${STORM_BREAK_CM} ${gauge ? 'mm of precipitation' : 'cm of new snow'} in the last ${STORM_BREAK_H} h`
    : `Storm ${gauge ? 'precipitation (1 mm counted as 1 cm)' : 'snow'} since ${r.start ? day.format(r.start) + ' MST' : 'the start of the data'}`
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
    records(id).then(data => { if (cell.isConnected) HN_FROM_PRECIP_IDS.has(id) ? show(cell, stormPrecip(data, Date.now(), {hn24}), 'gauge') : show(cell, stormSnow(data, Date.now(), {hn24})); })
      .catch(() => { if (cell.isConnected) { cell.textContent = '—'; cell.title = 'Archive unavailable'; } });
  }
}
window.fillHst = fill;
document.getElementById('refreshBtn')?.addEventListener('click', () => cache.clear());
fill();
