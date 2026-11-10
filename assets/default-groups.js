/* Default station groups: which group chips (and so which stations) are on when the page opens.
   A viewer saves the groups that are on now as their default; it is kept in this browser's
   localStorage, so each device (desktop, phone) remembers its own choice. A link with
   ?groups=3,4 opens with those groups instead, without changing the saved default.
   With nothing saved and no link, the page opens on Group 1 as before. */
(function (root) {
  const KEY = 'wx-default-groups';
  const FALLBACK = [1];

  /* "3,4" -> [3,4], keeping only known groups, in order, without repeats. */
  function parse(text, validGroups) {
    if (typeof text !== 'string' || !text.trim()) return [];
    const valid = new Set(validGroups);
    const out = [];
    text.split(/[\s,]+/).forEach(part => {
      const g = Number(part);
      if (Number.isInteger(g) && valid.has(g) && !out.includes(g)) out.push(g);
    });
    return out.sort((a, b) => a - b);
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  function saved(validGroups) {
    const ls = storage();
    let text = null;
    try { text = ls && ls.getItem(KEY); } catch (e) {}
    return parse(text, validGroups);
  }

  function fromUrl(validGroups, search) {
    let q = search;
    if (q == null) { try { q = root.location ? root.location.search : ''; } catch (e) { q = ''; } }
    let text = null;
    try { text = new URLSearchParams(q || '').get('groups'); } catch (e) {}
    return parse(text, validGroups);
  }

  /* Groups to switch on at page load: link first, then the saved default, then Group 1. */
  function initial(validGroups, search) {
    const link = fromUrl(validGroups, search);
    if (link.length) return link;
    const mine = saved(validGroups);
    if (mine.length) return mine;
    return FALLBACK.filter(g => validGroups.includes(g));
  }

  function save(groups) {
    const ls = storage();
    const list = Array.from(groups).map(Number).sort((a, b) => a - b);
    try { if (ls) ls.setItem(KEY, list.join(',')); return !!ls; } catch (e) { return false; }
  }

  function clear() {
    const ls = storage();
    try { if (ls) ls.removeItem(KEY); } catch (e) {}
  }

  function sameGroups(a, b) {
    const x = Array.from(a).map(Number).sort((p, q) => p - q);
    const y = Array.from(b).map(Number).sort((p, q) => p - q);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }

  /* Draws the "make these my default" line under the group chips and keeps it current.
     getGroups() returns the groups that are on now; labelFor(g) names a group. */
  function bindControl(el, validGroups, getGroups, labelFor) {
    if (!el) return function () {};
    function names(list) { return list.map(g => 'Group ' + g + (labelFor(g) ? ' · ' + labelFor(g) : '')).join(', '); }
    function render() {
      const now = Array.from(getGroups()).sort((a, b) => a - b);
      const mine = saved(validGroups);
      const isDefault = mine.length ? sameGroups(now, mine) : sameGroups(now, FALLBACK);
      el.textContent = '';
      const note = document.createElement('span');
      note.className = 'default-groups-note';
      if (isDefault) {
        note.textContent = mine.length ? '✓ Opens with these groups on this device' : 'Opens with Group 1 unless you set a default';
        el.appendChild(note);
        if (mine.length) {
          const reset = document.createElement('button');
          reset.type = 'button';
          reset.className = 'default-groups-btn';
          reset.textContent = 'Reset';
          reset.title = 'Open with Group 1 again on this device';
          reset.addEventListener('click', () => { clear(); render(); });
          el.appendChild(reset);
        }
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'default-groups-btn';
        btn.textContent = 'Make these groups my default';
        btn.title = 'Open with ' + names(now) + ' selected next time, on this device';
        btn.addEventListener('click', () => { save(now); render(); });
        el.appendChild(btn);
        if (mine.length) {
          note.textContent = 'Default: ' + mine.map(g => 'G' + g).join(', ');
          el.appendChild(note);
        }
      }
    }
    render();
    return render;
  }

  root.WxDefaultGroups = { KEY, parse, saved, fromUrl, initial, save, clear, sameGroups, bindControl };
})(typeof window !== 'undefined' ? window : globalThis);
