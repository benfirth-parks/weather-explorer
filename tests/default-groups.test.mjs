import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../assets/default-groups.js', import.meta.url), 'utf8');
const GROUPS = [1, 2, 3, 4, 5];

function load(store = {}, search = '') {
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const ctx = { localStorage, location: { search }, URLSearchParams };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  return { api: ctx.WxDefaultGroups, store };
}

test('opens on Group 1 with nothing saved', () => {
  assert.deepEqual([...load().api.initial(GROUPS)], [1]);
});

test('saved default is used on load', () => {
  const { api, store } = load();
  api.save(new Set([4, 3]));
  assert.equal(store['wx-default-groups'], '3,4');
  assert.deepEqual([...api.initial(GROUPS)], [3, 4]);
});

test('a ?groups= link wins over the saved default without changing it', () => {
  const { api, store } = load({ 'wx-default-groups': '3,4' }, '?groups=5');
  assert.deepEqual([...api.initial(GROUPS)], [5]);
  assert.equal(store['wx-default-groups'], '3,4');
});

test('unknown or junk groups are ignored', () => {
  const { api } = load({ 'wx-default-groups': '9,x' }, '?groups=0,abc');
  assert.deepEqual([...api.initial(GROUPS)], [1]);
  assert.deepEqual([...api.parse('5, 3 3,7', GROUPS)], [3, 5]);
});

test('reset returns to Group 1', () => {
  const { api } = load({ 'wx-default-groups': '5' });
  api.clear();
  assert.deepEqual([...api.initial(GROUPS)], [1]);
});

test('works when storage is blocked', () => {
  const ctx = { location: { search: '' }, URLSearchParams };
  Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('blocked'); } });
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  assert.deepEqual([...ctx.WxDefaultGroups.initial(GROUPS)], [1]);
  assert.equal(ctx.WxDefaultGroups.save([3]), false);
});
