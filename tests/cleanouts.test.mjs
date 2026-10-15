import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, parseTabs, tabForPair, parseWhen, cleanoutsFromCsv, CHECK_COL} from '../assets/cleanouts-data.js';

const MST = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi);
function row(cells) { const r = Array(CHECK_COL + 2).fill(''); for (const [i, v] of Object.entries(cells)) r[i] = v; return r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','); }

test('parseCsv handles quotes, commas and newlines', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,"x\ny",3\n'), [['a', 'b,c', 'd "e"'], ['1', 'x\ny', '3']]);
});

test('parseWhen reads common sheet formats as MST', () => {
  assert.equal(parseWhen('2026-10-14', '14:30'), MST(2026, 10, 14, 14, 30));
  assert.equal(parseWhen('10/14/2026 8:05:00'), MST(2026, 10, 14, 8, 5));
  assert.equal(parseWhen('14-Oct-2026', '2:15 PM'), MST(2026, 10, 14, 14, 15));
  assert.equal(parseWhen('Oct 14, 2026', '0930'), MST(2026, 10, 14, 9, 30));
  assert.equal(parseWhen('2026-10-14'), MST(2026, 10, 14, 12, 0));
  assert.equal(parseWhen('not a date'), null);
});

test('only rows with AC ticked become markers, labelled from the cleanout column', () => {
  const csv = [
    row({0: 'Date', 1: 'Time', [CHECK_COL]: 'Cleared', [CHECK_COL + 1]: 'Cleanout'}),
    row({0: '2026-10-12', 1: '07:00', [CHECK_COL]: 'FALSE', [CHECK_COL + 1]: 'Board'}),
    row({0: '2026-10-13', 1: '07:30', [CHECK_COL]: 'TRUE', [CHECK_COL + 1]: 'Storm board, HN board'}),
    row({0: '2026-10-11', 1: '16:00', [CHECK_COL]: 'TRUE', [CHECK_COL + 1]: 'Precip gauge'})
  ].join('\n');
  const {markers, columns} = cleanoutsFromCsv(csv);
  assert.deepEqual(markers, [
    {t: MST(2026, 10, 11, 16, 0), label: 'Precip gauge'},
    {t: MST(2026, 10, 13, 7, 30), label: 'Storm board, HN board'}
  ]);
  assert.equal(columns.label, 'Cleanout');
});

test('tab lookup uses the htmlview list, falling back to the known Bosworth gid', () => {
  const tabs = parseTabs('items.push({name: "Bow Summit", pageUrl: "x", gid: "11"});items.push({name: "Bosworth", pageUrl: "y", gid: "22"});');
  assert.deepEqual(tabs, [{name: 'Bow Summit', gid: '11'}, {name: 'Bosworth', gid: '22'}]);
  assert.equal(tabForPair('fts-bosup,fts-boslo', tabs).gid, '22');
  assert.equal(tabForPair('fts-vulture,fts-bowsummit', tabs).gid, '11');
  assert.equal(tabForPair('fts-bosup,fts-boslo', []).gid, '394237732');
  assert.equal(tabForPair('fts-simpup,fts-simplo', tabs), null);
});
