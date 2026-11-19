import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFeedback, feedbackKey, sameSecret, TOPICS} from '../netlify/functions/_plot-feedback.mjs';
import handler from '../netlify/functions/plot-feedback.mjs';

const NOW = Date.UTC(2026, 10, 18, 22, 0);
const good = {plot: 'bow_summit', agreement: 'disagree', topics: ['weak_layer', 'nope', 'weak_layer'], note: '  Surface hoar after clear nights not shown. ',
  name: 'BF', model_t: Date.UTC(2026, 10, 18, 12), model_hs: 61.4, pit_t: Date.UTC(2026, 10, 16, 18), team_code: 'secret'};

test('a good note is kept with the server receive time, never the client clock', () => {
  const r = validateFeedback({...good, received_at: '2020-01-01T00:00:00Z'}, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.record.received_at, '2026-11-18T22:00:00.000Z');
  assert.deepEqual(r.record.topics, ['weak_layer']);
  assert.equal(r.record.note, 'Surface hoar after clear nights not shown.');
  assert.equal(r.record.model_run_t, '2026-11-18T12:00:00.000Z');
  assert.equal(r.record.model_hs_cm, 61);
  assert.equal(r.record.pit_shown_t, '2026-11-16T18:00:00.000Z');
  assert.equal(r.record.source, 'banff-snowpack');
  assert.equal('team_code' in r.record, false);
});
test('a note needs a plot, a name, and either a verdict or words', () => {
  assert.equal(validateFeedback({...good, plot: '../x'}, NOW).ok, false);
  assert.equal(validateFeedback({...good, name: ' '}, NOW).ok, false);
  assert.equal(validateFeedback({...good, agreement: 'maybe', note: ''}, NOW).ok, false);
  assert.equal(validateFeedback({...good, agreement: null}, NOW).ok, true);
  assert.equal(validateFeedback({...good, note: ''}, NOW).ok, true);
  assert.equal(validateFeedback(null, NOW).ok, false);
});
test('long text is cut and bad times are dropped', () => {
  const r = validateFeedback({...good, note: 'x'.repeat(5000), name: 'y'.repeat(200), model_t: 'soon', pit_t: 5}, NOW);
  assert.equal(r.record.note.length, 2000);
  assert.equal(r.record.name.length, 60);
  assert.equal(r.record.model_run_t, null);
  assert.equal(r.record.pit_shown_t, null);
});
test('keys sort by receive time', () => {
  const a = validateFeedback(good, NOW).record, b = validateFeedback(good, NOW + 1000).record;
  assert.ok(feedbackKey(a, 'aaa') < feedbackKey(b, 'aaa'));
  assert.match(feedbackKey(a, 'abc'), /^2026-11-18\/2026-11-18T22:00:00.000Z-bow_summit-abc$/);
});
test('secrets compare exactly', () => {
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abcd'), false);
  assert.equal(sameSecret('', ''), false);
  assert.ok(TOPICS.includes('crust'));
});
test('a set team code is enforced, and listing needs the admin token', async () => {
  const old = {...process.env};
  try {
    delete process.env.FEEDBACK_TEAM_CODE; delete process.env.FEEDBACK_ADMIN_TOKEN;
    const post = body => handler(new Request('https://x/api/plot-feedback', {method: 'POST', body: JSON.stringify(body)}));
    assert.equal((await post({...good, name: ''})).status, 400);  // open posting still validates
    process.env.FEEDBACK_TEAM_CODE = 'other';
    assert.equal((await post(good)).status, 401);
    assert.equal((await handler(new Request('https://x/api/plot-feedback'))).status, 503);
    process.env.FEEDBACK_ADMIN_TOKEN = 'tok';
    assert.equal((await handler(new Request('https://x/api/plot-feedback', {headers: {'x-feedback-admin-token': 'bad'}}))).status, 401);
    assert.equal((await handler(new Request('https://x/api/plot-feedback', {method: 'PUT'}))).status, 405);
  } finally {
    process.env = old;
  }
});
