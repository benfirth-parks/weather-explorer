/* Temperature inversion warning at the top of the 24 h station summary (Ben, 14 Nov 2026).
   It is the note that leads the AI summary: /api/inversion works it out, by the rule in
   assets/inversion.js, from every station in the region of the groups that are switched on.
   The valley fire weather stations count even when their group is off, because they are the
   only stations below treeline. The page hands over the listed station ids in
   window.inversionNoteIds and calls window.fillInversionNote() each time the table is drawn. */
const host = window.weatherPairComparisonHost;
const el = document.getElementById('inversionNote');
const KEEP_MS = 5 * 60000;
let held = null; /* {key, at, promise}: the last answer, reused for KEEP_MS */

function groupsOf(ids) {
  const groups = ids.map((id) => host?.stations?.[id]?.group).filter(Number.isInteger);
  return [...new Set(groups)].sort((a, b) => a - b);
}

function show(note) {
  el.replaceChildren();
  el.hidden = !note;
  /* The note is Markdown with **bold** parts: the odd pieces between the asterisks are bold. */
  String(note || '').split('**').forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      const bold = document.createElement('strong');
      bold.textContent = part;
      el.append(bold);
    } else el.append(part);
  });
}

function fill() {
  if (!el) return;
  const groups = groupsOf(window.inversionNoteIds || []);
  if (!groups.length) { held = null; show(''); return; }
  const key = groups.join(',');
  if (!held || held.key !== key || Date.now() - held.at > KEEP_MS) {
    held = {
      key,
      at: Date.now(),
      promise: fetch(`/api/inversion?groups=${key}`).then((res) => (res.ok ? res.json() : null)).catch(() => null)
    };
  }
  const mine = held;
  mine.promise.then((data) => {
    if (held !== mine) return; /* the groups changed while this was loading */
    if (!data) held = null; /* failed: ask again on the next draw */
    show(data && typeof data.note === 'string' ? data.note : '');
  });
}

window.fillInversionNote = fill;
document.getElementById('refreshBtn')?.addEventListener('click', () => { held = null; });
fill();
