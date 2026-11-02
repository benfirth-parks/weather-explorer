/* NOAA LRGS (GOES DCS) feed: the primary source for station data.
   The stations transmit over GOES once an hour. NOAA's LRGS servers keep
   the raw messages, and this module fetches them over the DDS protocol
   (TCP 16003) and decodes them into the same records FTS360 gives us.

   Every field mapped below was checked against the FTS360 archive over
   14 days (Oct 19 to Nov 2 2026) and matched in 100% of hours. Waterton
   Townsite, Summit Lake and Akamina Pass have no FTS360 archive; their
   temp/RH/wind/HS were checked against Avalanche Canada (100%), and their
   precip totals sit in the same slots as the matching Maligne values.

   Records carry source: "noaa". Feed priority is NOAA, then FTS360, then
   Avalanche Canada (see mergeAndPrune in _weather-archive.mjs). */

import net from "node:net";
import { createHash } from "node:crypto";

export const NOAA_SOURCE = "noaa";
export const LRGS_SERVERS = [
  "cdadata.wcda.noaa.gov",
  "cdabackup.wcda.noaa.gov",
  "lrgseddn1.cr.usgs.gov",
  "lrgseddn2.cr.usgs.gov"
];
const PORT = 16003;
const PROTOCOL_VERSION = 14;
const SYNC = "FAF0";
const ERR_DMSGTIMEOUT = 11;
const ERR_DUNTIL = 35;
const ERR_DAUTHFAILED = 47;

/* ---- Station message layouts ----
   "lines": one value per line; map = line index -> field(s).
   "csv":   "<n> HH:MM:SS a,b,c..." ; map = comma index -> field(s).
   "coded": ":TA 57 #60 -5.9 :SD 12 #15 19 19 18 19" ; map = code -> field(s).
   Values sent as "////" or -99999 are treated as missing. */
const NEW = ["newSnow", "precipIncr"]; // FTS360 stores the gauge increment under both names
const FULL = { 2: "relativeHumidity", 5: "airTempAvg", 8: "windSpeedAvg", 9: "windDirAvg", 10: "windSpeedGust" };
const GAUGE = { ...FULL, 12: NEW, 25: "precipTotal" };
export const LRGS_STATIONS = {
  "fts-boslo":        { addr: "CBA5910C", format: "lines", map: { 0: "airTempAvg", 1: "relativeHumidity", 8: "snowHeight" } },
  "fts-stanley":      { addr: "CBA5C170", format: "lines", map: { 0: "airTempAvg", 1: "relativeHumidity", 8: "snowHeight" } },
  "fts-bosup":        { addr: "CBA5B7E0", format: "lines", map: { 0: "airTempAvg", 1: "relativeHumidity", 2: "windSpeedAvg", 3: "windDirAvg", 4: "windSpeedGust" } },
  "fts-whymper":      { addr: "C2B02E6E", format: "lines", map: { 0: "airTempAvg", 1: "relativeHumidity", 2: "windSpeedAvg", 3: "windDirAvg", 4: "windSpeedGust" } },
  "fts-lookout":      { addr: "CBA5E79C", format: "lines", map: { 0: "airTempAvg", 1: "relativeHumidity", 2: "windSpeedAvg", 3: "windDirAvg", 4: "windSpeedGust" } },
  "fts-vulture":      { addr: "CBA270CA", format: "lines", map: { 1: NEW, 2: "airTempAvg", 3: "relativeHumidity", 4: "windSpeedAvg", 5: "windDirAvg", 6: "windSpeedGust" } },
  "fts-simpup":       { addr: "CBA263BC", format: "lines", map: { 1: NEW, 2: "airTempAvg", 3: "relativeHumidity", 4: "windSpeedAvg", 5: "windDirAvg", 6: "windSpeedGust" } },
  "fts-simplo":       { addr: "CBA25626", format: "lines", map: { 1: NEW, 2: "airTempAvg", 3: "relativeHumidity", 14: "snowHeight" } },
  "fts-bowsummit":    { addr: "CBA233C0", format: "lines", map: { 1: NEW, 2: "airTempAvg", 3: "relativeHumidity", 14: "snowHeight" } },
  "fts-boulder":      { addr: "CBA47004", format: "lines", map: GAUGE },
  "fts-lakelouise":   { addr: "C2B01BF4", format: "lines", map: GAUGE },
  "fts-vermillion":   { addr: "CBA4A66C", format: "lines", map: GAUGE },
  "fts-devona":       { addr: "CBA15128", format: "lines", map: GAUGE },
  "fts-rangercreek":  { addr: "C2B058FE", format: "lines", map: GAUGE },
  "fts-saskcrossing": { addr: "CBA24550", format: "lines", map: GAUGE },
  "fts-castle":       { addr: "C2B14972", format: "lines", map: { ...FULL, 12: NEW, 25: "snowHeight" } },
  "fts-dorothy":      { addr: "CBA164B2", format: "lines", map: { ...FULL, 25: "precipTotal" } },
  "fts-maligne":      { addr: "C2B00882", format: "lines", map: { ...FULL, 25: "precipTotal", 29: "snowHeight" } },
  "fts-waterton":     { addr: "CBA06648", format: "lines", map: { ...FULL, 31: "precipTotal" } },
  "fts-summitlake":   { addr: "CBA096CC", format: "lines", map: { ...FULL, 31: "precipTotal", 34: "snowHeight" },
                        // depth sensor reports 350.0 with quality 0 when it has no reading
                        reject: (v) => v[34] != null && (v[34] >= 350 || v[36] === 0) ? ["snowHeight"] : [] },
  "fts-coleman":      { addr: "C2B17CE8", format: "csv", map: { 1: "airTempAvg", 2: "relativeHumidity", 3: "windSpeedGust", 4: "windDirPeak", 5: "snowHeight", 6: "windSpeedAvg", 7: "windDirAvg", 8: "airTempMax", 9: "airTempMin", 12: "precipTotal" } },
  "fts-bigbend":      { addr: "C2B16F9E", format: "csv", map: { 1: "airTempAvg", 2: "relativeHumidity", 3: "windSpeedGust", 4: "windDirPeak", 5: "snowHeight", 6: "precipTotal", 7: "windSpeedAvg", 8: "windDirAvg", 9: "airTempMax", 10: "airTempMin", 22: "newSnow" } },
  // NOAA's platform list calls CBA56188 "Parker Upper"; its data is Tangle Ridge's.
  "fts-tangleridge":  { addr: "CBA56188", format: "csv", map: { 1: "airTempAvg", 2: "relativeHumidity", 3: "windSpeedGust", 4: "windDirPeak", 5: "windSpeedAvg", 6: "windDirAvg", 7: "airTempMax", 8: "airTempMin" } },
  "fts-sunshine":     { addr: "44548250", format: "coded", map: { PC: "precipTotal", TA: "airTempAvg", SW: "newSnow", SD: "snowHeight" } },
  "fts-bowprecip":    { addr: "4455A646", format: "coded", map: { PC: "precipTotal", TA: "airTempAvg", SD: "snowHeight" } },
  "fts-pikarun":      { addr: "4454C15A", format: "coded", map: { PC: "precipTotal", TA: "airTempAvg", RH: "relativeHumidity", Depth: "snowHeight" } },
  "fts-skoki":        { addr: "4441E7E8", format: "coded", map: { PC: "precipTotal", TA: "airTempAvg", SW: "newSnow" } },
  "fts-akamina":      { addr: "4441041A", format: "coded", map: { PC: "precipTotal", TA: "airTempAvg", XR: "relativeHumidity", SD: "snowHeight" } }
};
const BY_ADDR = Object.fromEntries(Object.entries(LRGS_STATIONS).map(([id, s]) => [s.addr, id]));

/* ---- Decoding ---- */
function value(text) {
  const s = String(text ?? "").trim();
  if (!s || /^\/+$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v) || v <= -9999) return null;
  return v;
}

const hourOf = (ms) => Math.floor(ms / 3_600_000) * 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

function assign(rec, fields, v) {
  for (const f of [].concat(fields)) rec[f] = v;
}

/** "YYDDDHHMMSS" (UTC) -> ms */
export function goesTime(s) {
  const m = /^(\d\d)(\d\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(s || ""));
  if (!m) return Number.NaN;
  const [, yy, ddd, hh, mi, ss] = m.map(Number);
  return Date.UTC(2000 + yy, 0, ddd, hh, mi, ss);
}

/** Decodes one message body into archive records (one per timestamp). */
export function decodeBody(stationId, body, sentMs) {
  const st = LRGS_STATIONS[stationId];
  if (!st || !Number.isFinite(sentMs)) return [];
  const text = String(body);
  if (st.format === "lines" || st.format === "csv") {
    let vals, t;
    if (st.format === "lines") {
      vals = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== '"').map(value);
      t = hourOf(sentMs); // values are for the top of the hour the message is sent in
    } else {
      const m = /\d+ (\d\d):(\d\d):\d\d ([^\r\n]*)/.exec(text);
      if (!m) return [];
      vals = m[3].split(",").map(value);
      t = hourOf(sentMs);
      // the line carries its own hour; use it when it differs (sent just after midnight etc.)
      const own = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate(), Number(m[1]), Number(m[2]));
      t = own > sentMs + 600_000 ? own - 86_400_000 : own;
    }
    const rejected = new Set(st.reject ? st.reject(vals) : []);
    const rec = { measurementDateTime: iso(t), source: NOAA_SOURCE };
    let any = false;
    for (const [idx, fields] of Object.entries(st.map)) {
      const v = vals[Number(idx)];
      if (v === null || v === undefined) continue;
      const keep = [].concat(fields).filter((f) => !rejected.has(f));
      if (!keep.length) continue;
      assign(rec, keep, v);
      any = true;
    }
    return any ? [rec] : [];
  }
  // coded: ":CODE <minutes before send> #<interval> v1 v2 ..." newest first
  const byTime = new Map();
  const re = /:([A-Za-z][A-Za-z0-9 ]*?) (\d+) #(\d+)((?: -?[\d.]+)+)/g;
  let m;
  const base = Math.floor(sentMs / 60_000) * 60_000;
  while ((m = re.exec(text))) {
    const fields = st.map[m[1]];
    if (!fields) continue;
    const t0 = base - Number(m[2]) * 60_000;
    const step = Number(m[3]) * 60_000;
    m[4].trim().split(/\s+/).forEach((s, i) => {
      const v = value(s);
      if (v === null) return;
      const t = t0 - i * step;
      if (!byTime.has(t)) byTime.set(t, { measurementDateTime: iso(t), source: NOAA_SOURCE });
      assign(byTime.get(t), fields, v);
    });
  }
  return [...byTime.values()];
}

/** Raw DCP message (37-byte DOMSAT header + body) -> { stationId, records } or null. */
export function decodeMessage(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "latin1");
  if (buf.length < 37) return null;
  const header = buf.subarray(0, 37).toString("latin1");
  const stationId = BY_ADDR[header.slice(0, 8)];
  if (!stationId) return null;
  if (header[19] !== "G") return null; // only good-quality messages
  const records = decodeBody(stationId, buf.subarray(37).toString("latin1"), goesTime(header.slice(8, 19)));
  return { stationId, records };
}

/* ---- DDS client ---- */
function authenticator(user, password, timet, algo) {
  // The stored password hash is always SHA-1; the authenticator may be SHA-256.
  const pre = createHash("sha1").update(user + password + user + password, "latin1").digest();
  const tb = Buffer.alloc(4);
  tb.writeUInt32BE(timet >>> 0);
  const u = Buffer.from(user, "latin1");
  return createHash(algo).update(Buffer.concat([u, pre, tb, u, pre, tb])).digest("hex").toUpperCase();
}

function yyddd(ms) {
  const d = new Date(ms);
  const doy = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear() % 100)}${p(doy, 3)}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

class Conn {
  constructor(host, timeoutMs) {
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.err = null;
    this.sock = net.connect({ host, port: PORT });
    this.sock.setTimeout(timeoutMs, () => this.sock.destroy(new Error(`LRGS ${host} timed out`)));
    this.sock.on("data", (d) => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    this.sock.on("error", (e) => { this.err = e; this.wake(); });
    this.sock.on("close", () => { this.err = this.err || new Error("LRGS connection closed"); this.wake(); });
    this.ready = new Promise((res, rej) => { this.sock.once("connect", res); this.sock.once("error", rej); });
  }
  wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async read(n) {
    while (this.buf.length < n) {
      if (this.err) throw this.err;
      await new Promise((r) => this.waiters.push(r));
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  send(type, body = "") {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1");
    this.sock.write(Buffer.concat([Buffer.from(`${SYNC}${type}${String(b.length).padStart(5, "0")}`, "latin1"), b]));
  }
  async recv() {
    const hdr = (await this.read(10)).toString("latin1");
    if (!hdr.startsWith(SYNC)) throw new Error(`LRGS bad sync ${JSON.stringify(hdr)}`);
    const len = Number(hdr.slice(5, 10));
    return { type: hdr[4], body: len ? await this.read(len) : Buffer.alloc(0) };
  }
  close() { try { this.send("b"); } catch { /* ignore */ } this.sock.destroy(); }
}

class LrgsError extends Error {
  constructor(code, text) { super(`LRGS error ${code}: ${text}`); this.code = code; }
}
function checkError(body) {
  if (body[0] !== 0x3f) return; // '?'
  const parts = body.subarray(1).toString("latin1").split(",");
  throw new LrgsError(Number(parts[0]), parts.slice(2).join(",").trim());
}

async function hello(host, user, password, algo, timeoutMs) {
  const c = new Conn(host, timeoutMs);
  try {
    await c.ready;
    const now = Date.now();
    c.send("m", `${user} ${yyddd(now)} ${authenticator(user, password, Math.floor(now / 1000), algo)} ${PROTOCOL_VERSION}`);
    const { body } = await c.recv();
    checkError(body);
    return c;
  } catch (e) {
    c.close();
    throw e;
  }
}

/** Fetches raw messages for the given addresses since `sinceHours` ago. */
export async function fetchLrgsMessages({ addresses, sinceHours, user, password, servers = LRGS_SERVERS, deadlineMs = 15000 }) {
  const stopAt = Date.now() + deadlineMs;
  let lastErr;
  for (const host of servers) {
    if (Date.now() >= stopAt) break;
    let c;
    try {
      try {
        c = await hello(host, user, password, "sha256", deadlineMs);
      } catch (e) {
        if (!(e instanceof LrgsError && e.code === ERR_DAUTHFAILED)) throw e;
        c = await hello(host, user, password, "sha1", deadlineMs);
      }
      const crit = [`DRS_SINCE: now - ${Math.max(1, Math.round(sinceHours))} hours`, "DRS_UNTIL: now",
        ...addresses.map((a) => `DCP_ADDRESS: ${a}`)].join("\n") + "\n";
      c.send("g", Buffer.concat([Buffer.alloc(50, 0x20), Buffer.from(crit, "latin1")]));
      checkError((await c.recv()).body);
      const out = [];
      while (Date.now() < stopAt) {
        c.send("n");
        const { body } = await c.recv();
        try { checkError(body); } catch (e) {
          if (e instanceof LrgsError && (e.code === ERR_DUNTIL || e.code === ERR_DMSGTIMEOUT)) break;
          throw e;
        }
        let off = 0;
        while (off + 37 <= body.length) {
          const len = Number(body.subarray(off + 32, off + 37).toString("latin1"));
          if (!Number.isFinite(len) || off + 37 + len > body.length) break;
          out.push(body.subarray(off, off + 37 + len));
          off += 37 + len;
        }
      }
      c.close();
      return { host, messages: out };
    } catch (e) {
      lastErr = e;
      if (c) c.close();
      console.warn(JSON.stringify({ event: "lrgs-server-failed", host, error: e?.message || String(e) }));
    }
  }
  throw lastErr || new Error("LRGS: no server reached");
}

/** NOAA records for every LRGS station since `sinceHours` ago: Map stationId -> records. */
export async function fetchNoaaRecords({ sinceHours = 3, deadlineMs, env = process.env, fetchImpl = fetchLrgsMessages } = {}) {
  const user = env.LRGS_USER, password = env.LRGS_PASSWORD;
  if (!user || !password) return { configured: false, byStation: new Map() };
  const { host, messages } = await fetchImpl({
    addresses: Object.values(LRGS_STATIONS).map((s) => s.addr), sinceHours, user, password, deadlineMs
  });
  const byStation = new Map();
  for (const raw of messages) {
    const d = decodeMessage(raw);
    if (!d || !d.records.length) continue;
    if (!byStation.has(d.stationId)) byStation.set(d.stationId, []);
    byStation.get(d.stationId).push(...d.records);
  }
  return { configured: true, host, messageCount: messages.length, byStation };
}
