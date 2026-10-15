import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, parseTabs, tabForPair, parseWhen, cleanoutsFromCsv} from '../assets/cleanouts-data.js';

const MST = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi);

test('parseCsv handles quotes, commas and newlines', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,"x\ny",3\n'), [['a', 'b,c', 'd "e"'], ['1', 'x\ny', '3']]);
});

test('parseWhen reads common sheet formats as MST', () => {
  assert.equal(parseWhen('2026-10-14', '14:30'), MST(2026, 10, 14, 14, 30));
  assert.equal(parseWhen('10/14/2026 8:05:00'), MST(2026, 10, 14, 8, 5));
  assert.equal(parseWhen('14-Oct-2026', '2:15 PM'), MST(2026, 10, 14, 14, 15));
  assert.equal(parseWhen('Oct 14, 2026', '0930'), MST(2026, 10, 14, 9, 30));
  assert.equal(parseWhen('2026-10-14'), MST(2026, 10, 14, 8, 0));
  assert.equal(parseWhen('not a date'), null);
});

test('ticked A/C days become markers, labelled from the Cleanout cell in the same month block', () => {
  // Same layout as the field sheet: a title row, then side-by-side month blocks.
  const csv = [
    'Bosworth Lower - 2026/2027 - Monthly Accumulation,,,,,,,,,,,',
    'November 2026,HN 24,Accum. HN 24 (cm),A/C,Cleanout,,December 2026,HN 24,Accum. HN 24 (cm),A/C,Cleanout,',
    ',,,,,,,,,,,',
    '2026-11-01,,0,FALSE,,,2026-12-01,,0,FALSE,,',
    '2026-11-02,4,4,TRUE,Board + gauge,,2026-12-02,,0,TRUE,,',
    '2026-11-03,,4,FALSE,,,2026-12-03,,0,TRUE,TRUE,'
  ].join('\n');
  const {markers, columns} = cleanoutsFromCsv(csv);
  assert.deepEqual(markers, [
    {t: MST(2026, 11, 2, 8, 0), cleanout: 'Board + gauge'},
    {t: MST(2026, 12, 2, 8, 0), cleanout: ''},
    {t: MST(2026, 12, 3, 8, 0), cleanout: 'Cleanout'}
  ]);
  assert.deepEqual(columns.blocks, [{ac: 3, cleanout: 4}, {ac: 9, cleanout: 10}]);
});

test('a tab with no A/C header gives no markers', () => {
  assert.deepEqual(cleanoutsFromCsv('Date,Value\n2026-11-01,TRUE\n').markers, []);
});

test('tab lookup uses the htmlview list, falling back to the known Bosworth gid', () => {
  const tabs = parseTabs('items.push({name: "Bosworth Lower", pageUrl: "y", gid: "22"});items.push({name: "Bow Summit", pageUrl: "x", gid: "11"});');
  assert.deepEqual(tabs, [{name: 'Bosworth Lower', gid: '22'}, {name: 'Bow Summit', gid: '11'}]);
  assert.equal(tabForPair('fts-bosup,fts-boslo', tabs).gid, '22');
  assert.equal(tabForPair('fts-vulture,fts-bowsummit', tabs).gid, '11');
  assert.equal(tabForPair('fts-bosup,fts-boslo', []).gid, '394237732');
  assert.equal(tabForPair('fts-simpup,fts-simplo', tabs), null);
});
