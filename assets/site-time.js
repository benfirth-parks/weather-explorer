/* Site clock: every time on the site is Alberta clock time, UTC-6 year-round from Nov 1 2026, labelled MT.
   Never the viewer's device time zone, and never 'America/Edmonton' (a browser with older time zone data
   would still show MST, UTC-7). Load after Chart.js and its date adapter, before any chart is made.

   window.siteTime.format(ms, opts)  -> Intl formatting in UTC-6 (opts as for toLocaleString)
   Chart.js time axes: the date adapter is wrapped so tick labels and tick boundaries (hour, midnight,
   day) fall on the site clock rather than the viewer's. */
(function () {
  const ZONE = 'Etc/GMT+6'; // POSIX sign: GMT+6 means UTC-6
  const SITE_OFFSET_MIN = -360;

  function format(ms, opts) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleString('en-CA', Object.assign({}, opts, {timeZone: ZONE}));
  }
  window.siteTime = {ZONE, format};

  if (!window.Chart || !Chart._adapters || !Chart._adapters._date) return;
  /* The date-fns adapter works in the viewer's zone. The site clock is a fixed offset, so calendar maths
     (tick boundaries, stepping, differences) is done here in UTC shifted by -6 h, free of the viewer's
     DST changes. Only text formatting goes to date-fns, given a timestamp whose viewer-local wall clock
     equals the site wall clock. */
  const OFF = SITE_OFFSET_MIN * 60000;
  const viewerOffsetMin = t => -new Date(t).getTimezoneOffset();
  function toLocal(t) {
    let f = t + (SITE_OFFSET_MIN - viewerOffsetMin(t)) * 60000;
    return t + (SITE_OFFSET_MIN - viewerOffsetMin(f)) * 60000; // second pass settles a viewer DST change
  }
  const MS = {millisecond: 1, second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5};
  const MONTHS = {month: 1, quarter: 3, year: 12};
  function add(t, amount, unit) {
    if (MS[unit]) return t + amount * MS[unit];
    const d = new Date(t + OFF);
    d.setUTCMonth(d.getUTCMonth() + amount * (MONTHS[unit] || 1));
    return d.getTime() - OFF;
  }
  function startOf(t, unit, weekday) {
    const d = new Date(t + OFF);
    switch (unit) {
      case 'second': d.setUTCMilliseconds(0); break;
      case 'minute': d.setUTCSeconds(0, 0); break;
      case 'hour': d.setUTCMinutes(0, 0, 0); break;
      case 'day': d.setUTCHours(0, 0, 0, 0); break;
      case 'week': case 'isoWeek': {
        const first = unit === 'isoWeek' ? (+weekday || 0) % 7 : 0;
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - first + 7) % 7));
        break;
      }
      case 'month': d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); break;
      case 'quarter': d.setUTCHours(0, 0, 0, 0); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - d.getUTCMonth() % 3); break;
      case 'year': d.setUTCHours(0, 0, 0, 0); d.setUTCMonth(0, 1); break;
      default: return t;
    }
    return d.getTime() - OFF;
  }
  const proto = Chart._adapters._date.prototype;
  const orig = {format: proto.format, diff: proto.diff};
  Chart._adapters._date.override({
    format(t, fmt) { return orig.format.call(this, toLocal(t), fmt); },
    startOf(t, unit, weekday) { return startOf(t, unit, weekday); },
    endOf(t, unit) { const u = unit === 'isoWeek' ? 'week' : unit; return add(startOf(t, unit), 1, u) - 1; },
    add(t, amount, unit) { return add(t, amount, unit); },
    diff(a, b, unit) { return MS[unit] ? Math.trunc((a - b) / MS[unit]) : orig.diff.call(this, toLocal(a), toLocal(b), unit); }
  });
})();
