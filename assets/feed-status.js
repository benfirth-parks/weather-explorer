/* FTS360 feed status banner.
   Checks the newest reading at a few busy stations. When even the newest one is
   older than STALE_HOURS, a warning banner at the top of the page says FTS360
   isn't updating and when the last reading came in. The banner goes away by
   itself once fresh data arrives (rechecked every 10 minutes). */
(function () {
  const STATIONS = ["fts-boslo", "fts-vulture", "fts-sunshine", "fts-bowsummit", "fts-whymper"];
  const STALE_HOURS = 3;
  const RECHECK_MS = 10 * 60 * 1000;

  // Newest FTS360 reading, and newest reading of any source (Avalanche Canada
  // backup records carry source: "avalanche-canada").
  function newestTimes(records) {
    let fts = NaN, any = NaN;
    for (const r of Array.isArray(records) ? records : []) {
      const t = new Date(r && r.measurementDateTime).getTime();
      if (!Number.isFinite(t)) continue;
      if (!(t <= any)) any = t;
      if (!r.source && !(t <= fts)) fts = t;
    }
    return { fts, any };
  }

  function formatTime(ms) {
    return new Date(ms).toLocaleString("en-CA", {
      timeZone: "America/Edmonton",
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short"
    });
  }

  function banner() {
    let el = document.getElementById("feedStatusBanner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "feedStatusBanner";
    el.className = "feed-status-banner";
    el.setAttribute("role", "status");
    el.hidden = true;
    document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  async function check() {
    const results = await Promise.allSettled(STATIONS.map(async (id) => {
      const res = await fetch(`/api/fts?station=${encodeURIComponent(id)}&hours=168`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      return newestTimes(await res.json());
    }));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const times = ok.map((v) => v.fts).filter(Number.isFinite);
    const anyTimes = ok.map((v) => v.any).filter(Number.isFinite);
    // If the check itself failed, say nothing rather than guess.
    if (results.every((r) => r.status === "rejected")) return;

    const el = banner();
    const newest = times.length ? Math.max(...times) : NaN;
    const stale = !Number.isFinite(newest) || Date.now() - newest > STALE_HOURS * 3600 * 1000;
    if (!stale) { el.hidden = true; return; }
    const since = Number.isFinite(newest) ? ` The latest FTS360 reading is from ${formatTime(newest)}.` : "";
    const newestAny = anyTimes.length ? Math.max(...anyTimes) : NaN;
    const backupFresh = Number.isFinite(newestAny) && Date.now() - newestAny <= STALE_HOURS * 3600 * 1000;
    el.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Data delayed: ";
    el.appendChild(strong);
    el.appendChild(document.createTextNode(
      backupFresh
        ? `FTS360 is not currently updating.${since} Since then, snow height, temperature, wind and RH for most Parks stations come from Avalanche Canada's copy of the same station feed; HW and some stations are missing until FTS360 is back.`
        : `FTS360 is not currently updating, so station data on this page is behind.${since} It will catch up automatically once FTS360 is back.`
    ));
    el.hidden = false;
  }

  function start() {
    check().catch(() => {});
    setInterval(() => check().catch(() => {}), RECHECK_MS);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
