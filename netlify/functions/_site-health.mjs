import { getStore } from "@netlify/blobs";
import { readArchive } from "./_weather-archive.mjs";
import { isBackupRecord } from "./_avcan.mjs";
import { NOAA_SOURCE } from "./_lrgs.mjs";

/* Site health check. Runs hourly (site-health-check.mjs, 45 past the hour,
   half an hour after the station sync) and looks at the station archive the
   site serves. Each problem is an "incident": it is opened (one alert email)
   when first seen and closed (one recovery email) when it clears, so an
   outage sends two emails, not one an hour.

   Email goes out through Resend when RESEND_API_KEY and ALERT_EMAIL are set
   on Netlify. Without them the GitHub "Site watchdog" workflow raises the
   same incidents as GitHub issues, which GitHub emails to the repo owner. */

const STORE_NAME = "site-health-v1";
const STATE_KEY = "state.json";

/* Busy stations on all three feeds; the same set the "Data delayed" banner uses. */
export const HEALTH_STATIONS = ["fts-boslo", "fts-vulture", "fts-sunshine", "fts-bowsummit", "fts-whymper"];

const H = 3600 * 1000;
export const LIMITS = {
  syncHours: 2.5,     // newest station sync (runs hourly at :15)
  dataHours: 3,       // newest reading from any feed
  primaryHours: 3,    // newest NOAA or FTS360 reading
  noaaHours: 3,       // newest NOAA reading
  ftsHours: 6         // newest FTS360 reading (fallback feed)
};

const isFts = (r) => !r.source || r.ftsSeen === true;

function newest(observations, keep) {
  for (let i = observations.length - 1; i >= 0; i--) {
    const r = observations[i];
    if (!keep(r)) continue;
    const t = new Date(r.measurementDateTime).getTime();
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

/** Newest times for one station archive. */
export function stationTimes(archive) {
  const obs = Array.isArray(archive?.observations) ? archive.observations : [];
  return {
    synced: new Date(archive?.lastSyncedAt || NaN).getTime(),
    any: newest(obs, () => true),
    primary: newest(obs, (r) => !isBackupRecord(r)),
    noaa: newest(obs, (r) => r.source === NOAA_SOURCE),
    fts: newest(obs, isFts)
  };
}

const maxOf = (list, key) => {
  const v = list.map((s) => s[key]).filter(Number.isFinite);
  return v.length ? Math.max(...v) : NaN;
};

export function formatMt(ms) {
  if (!Number.isFinite(ms)) return "never";
  // Alberta stays on UTC-6 from Nov 2026; the site labels it MT.
  const d = new Date(ms - 6 * H);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} MT`;
}

const ago = (now, t) => Number.isFinite(t) ? `${Math.round((now - t) / H * 10) / 10} h ago` : "no readings";

/** Turn per-station times into a list of current problems ({key, title, detail}). */
export function evaluate(times, now = Date.now()) {
  const problems = [];
  const synced = maxOf(times, "synced");
  const any = maxOf(times, "any");
  const primary = maxOf(times, "primary");
  const noaa = maxOf(times, "noaa");
  const fts = maxOf(times, "fts");
  const old = (t, hours) => !Number.isFinite(t) || now - t > hours * H;

  if (old(synced, LIMITS.syncHours)) {
    problems.push({
      key: "sync-stopped",
      title: "Hourly station sync has stopped",
      detail: `The site's hourly station sync last ran ${formatMt(synced)} (${ago(now, synced)}). Station data will not update until it runs again. Check the fts-sync function log on Netlify.`
    });
  }
  if (old(any, LIMITS.dataHours)) {
    problems.push({
      key: "data-stale",
      title: "Station data is not updating",
      detail: `The newest station reading from any feed (NOAA, FTS360 or Avalanche Canada) is from ${formatMt(any)} (${ago(now, any)}). The site is showing old data.`
    });
  } else if (old(primary, LIMITS.primaryHours)) {
    problems.push({
      key: "on-backup",
      title: "NOAA and FTS360 are both down; site is on Avalanche Canada backup",
      detail: `The newest NOAA or FTS360 reading is from ${formatMt(primary)} (${ago(now, primary)}). The site is filling snow height, temperature, wind and RH from Avalanche Canada; HW and some stations are missing until a feed is back.`
    });
  }
  if (!old(primary, LIMITS.primaryHours) && old(noaa, LIMITS.noaaHours)) {
    problems.push({
      key: "noaa-down",
      title: "NOAA LRGS feed is down; site is using FTS360",
      detail: `The newest NOAA reading is from ${formatMt(noaa)} (${ago(now, noaa)}). FTS360 is filling in, so the site is still current. Check the fts-sync function log on Netlify for "noaa-fetch-failed".`
    });
  }
  if (!old(noaa, LIMITS.noaaHours) && old(fts, LIMITS.ftsHours)) {
    problems.push({
      key: "fts-down",
      title: "FTS360 feed is down (NOAA still working)",
      detail: `The newest FTS360 reading is from ${formatMt(fts)} (${ago(now, fts)}). NOAA is still current so the site is fine, but there is one less fallback.`
    });
  }
  return problems;
}

/** Compare current problems with open incidents. Returns what to open and close. */
export function diffIncidents(open, problems, now = Date.now()) {
  const next = {};
  const opened = [];
  const closed = [];
  for (const p of problems) {
    if (open[p.key]) next[p.key] = { ...open[p.key], title: p.title, detail: p.detail };
    else {
      next[p.key] = { ...p, openedAt: new Date(now).toISOString() };
      opened.push(next[p.key]);
    }
  }
  for (const [key, inc] of Object.entries(open)) {
    if (!next[key]) closed.push({ ...inc, key, closedAt: new Date(now).toISOString() });
  }
  return { next, opened, closed };
}

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL);

const SITE = "https://rockiesweatherdataexplorer.netlify.app";

export async function sendEmail(subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_FROM || "Rockies Weather Explorer <onboarding@resend.dev>",
      to: process.env.ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean),
      subject,
      text
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export function alertEmail(inc) {
  return {
    subject: `[Wx Explorer] Problem: ${inc.title}`,
    text: `${inc.detail}\n\nFirst seen ${formatMt(new Date(inc.openedAt).getTime())}. You will get one more email when this clears.\n\n${SITE}\n`
  };
}

export function recoveryEmail(inc) {
  const mins = Math.round((new Date(inc.closedAt) - new Date(inc.openedAt)) / 60000);
  const dur = mins >= 120 ? `${Math.round(mins / 6) / 10} h` : `${mins} min`;
  return {
    subject: `[Wx Explorer] Resolved: ${inc.title}`,
    text: `This has cleared as of ${formatMt(new Date(inc.closedAt).getTime())} (open about ${dur}).\n\n${SITE}\n`
  };
}

const store = () => getStore(STORE_NAME);

export async function readState() {
  return (await store().get(STATE_KEY, { type: "json" })) || { incidents: {} };
}

/** Full hourly run: check, update incidents, send emails, save state. */
export async function runHealthCheck(now = Date.now()) {
  const state = await readState();
  const times = [];
  const errors = [];
  for (const id of HEALTH_STATIONS) {
    try { times.push(stationTimes(await readArchive(id))); }
    catch (err) { errors.push(`${id}: ${err?.message || err}`); }
  }
  const problems = evaluate(times, now);
  const { next, opened, closed } = diffIncidents(state.incidents || {}, problems, now);

  const email = emailConfigured();
  const emailErrors = [];
  if (email) {
    for (const inc of opened) {
      try { const m = alertEmail(inc); await sendEmail(m.subject, m.text); next[inc.key].emailedAt = new Date().toISOString(); }
      catch (err) { emailErrors.push(err?.message || String(err)); }
    }
    for (const inc of closed) {
      // Only send a recovery for incidents whose alert actually went out.
      if (!inc.emailedAt) continue;
      try { const m = recoveryEmail(inc); await sendEmail(m.subject, m.text); }
      catch (err) { emailErrors.push(err?.message || String(err)); }
    }
    // Retry the alert next hour for open incidents whose email failed.
    for (const inc of Object.values(next)) {
      if (inc.emailedAt || opened.includes(inc)) continue;
      try { const m = alertEmail(inc); await sendEmail(m.subject, m.text); inc.emailedAt = new Date().toISOString(); }
      catch (err) { emailErrors.push(err?.message || String(err)); }
    }
  }

  const saved = {
    lastRunAt: new Date(now).toISOString(),
    emailConfigured: email,
    newest: {
      synced: formatMt(maxOf(times, "synced")),
      anyFeed: formatMt(maxOf(times, "any")),
      noaaOrFts: formatMt(maxOf(times, "primary")),
      noaa: formatMt(maxOf(times, "noaa")),
      fts360: formatMt(maxOf(times, "fts"))
    },
    incidents: next,
    readErrors: errors,
    emailErrors
  };
  await store().setJSON(STATE_KEY, saved);
  return { ...saved, opened: opened.map((i) => i.key), closed: closed.map((i) => i.key) };
}
