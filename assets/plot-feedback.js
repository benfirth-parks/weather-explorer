/* Forecaster feedback box under the modelled study-plot snowpack.
   Forecasters say whether they agree with the model run shown, tick what the note is
   about, and write what they see that the model may miss. Notes go to /api/plot-feedback. Notes and names stay internal: they are never shown here
   and never published on the Banff Snowpack site. The Banff Snowpack lab turns them into
   rules that are tested on past pits before they can change any forecast. */
const TOPICS = [
  ['depth', 'Snow depth'], ['weak_layer', 'Weak layer'], ['crust', 'Crust'],
  ['surface', 'Surface snow'], ['wind', 'Wind effect'], ['temperature', 'Temperatures'], ['other', 'Other']
];
const AGREE = [['agree', 'Agree'], ['partly', 'Partly'], ['disagree', 'Disagree']];
const MEMO = 'plot-feedback-me-v1';
let seq = 0;

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function remembered() {
  try { return JSON.parse(localStorage.getItem(MEMO) || '{}') || {}; } catch { return {}; }
}
function remember(me) {
  try { localStorage.setItem(MEMO, JSON.stringify(me)); } catch { /* private window: fine */ }
}

/* Builds the box for one plot profile. `data` is the /api/plot-profile answer; `pitShown` says
   whether the observed pit was drawn beside the model, so the lab knows what the forecaster saw. */
export function feedbackBox(data, {pitShown = false} = {}) {
  const id = `pfb-${++seq}`;
  const box = element('details', 'plot-feedback');
  box.append(element('summary', '', 'Forecaster feedback on this model run'));
  const form = element('form', 'plot-feedback-form');
  form.noValidate = true;
  const intro = element('p', 'plot-profile-note',
    'Does this modelled snowpack match what you know of the plot? Notes are internal to the forecast team and help test rules that may later adjust the model. They are never published.');

  const agree = element('fieldset', 'plot-feedback-agree');
  agree.append(element('legend', '', 'Overall'));
  for (const [value, label] of AGREE) {
    const l = element('label'), r = element('input');
    r.type = 'radio'; r.name = `${id}-agree`; r.value = value;
    l.append(r, document.createTextNode(` ${label}`));
    agree.append(l);
  }

  const topics = element('fieldset', 'plot-feedback-topics');
  topics.append(element('legend', '', 'About'));
  for (const [value, label] of TOPICS) {
    const l = element('label'), c = element('input');
    c.type = 'checkbox'; c.value = value;
    l.append(c, document.createTextNode(` ${label}`));
    topics.append(l);
  }

  const noteLabel = element('label', 'plot-feedback-field');
  const note = element('textarea');
  note.rows = 3; note.maxLength = 2000;
  note.placeholder = 'Agreement, disagreement, things the model may not account for…';
  noteLabel.append(element('span', '', 'Note'), note);

  const me = remembered();
  const who = element('div', 'plot-feedback-who');
  const nameLabel = element('label', 'plot-feedback-field'), name = element('input');
  name.type = 'text'; name.maxLength = 60; name.autocomplete = 'name'; name.value = me.name || '';
  nameLabel.append(element('span', '', 'Name or initials'), name);
  who.append(nameLabel);

  const send = element('button', 'plot-feedback-send', 'Save note');
  send.type = 'submit';
  const status = element('p', 'plot-feedback-status');
  status.setAttribute('role', 'status');

  form.append(intro, agree, topics, noteLabel, who, send, status);
  box.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const agreement = form.querySelector(`input[name="${id}-agree"]:checked`)?.value || null;
    const chosen = [...topics.querySelectorAll('input:checked')].map(c => c.value);
    if (!agreement && !note.value.trim()) { status.textContent = 'Pick agree, partly or disagree, or write a note.'; return; }
    if (!name.value.trim()) { status.textContent = 'Add your name or initials.'; return; }
    send.disabled = true;
    status.textContent = 'Saving…';
    try {
      const r = await fetch('/api/plot-feedback', {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify({
          plot: data.plot, source: data.source || 'banff-snowpack', name: name.value.trim(),
          agreement, topics: chosen, note: note.value, model_t: data.sim?.t ?? null, model_hs: data.sim?.hs ?? null, pit_t: pitShown ? data.pit?.t ?? null : null
        })
      });
      const answer = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(answer.error || `HTTP ${r.status}`);
      remember({name: name.value.trim()});
      form.reset();
      name.value = remembered().name || '';
      status.textContent = 'Saved. Thank you.';
    } catch (error) {
      status.textContent = `Not saved: ${error.message}`;
    } finally {
      send.disabled = false;
    }
  });
  return box;
}
