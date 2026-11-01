/* FTS360 feed status banner.
   Checks the newest reading at a few busy stations. When even the newest one is
   older than STALE_HOURS, a warning banner at the top of the page says FTS360
   isn't updating and when the last reading came in. The banner goes away by
   itself once fresh data arrives (rechecked every 10 minutes). */
(function () {
  const STATIONS = ["fts-boslo", "fts-vulture", "fts-sunshine", "fts-bowsummit", "fts-whymper"];
  const STALE_HOURS = 3;
  const RECHECK_MS = 10 * 60 * 1000;

  function newestTime(records) {
    let best = NaN;
    for (const r of Array.isArray(records) ? records : []) {
      const t = new Date(r && r.measurementDateTime).getTime();
      if (Number.isFinite(t) && !(t <= best)) best = t;
    }
    return best;
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
      return newestTime(await res.json());
    }));
    const times = results.filter((r) => r.status === "fulfilled" && Number.isFinite(r.value)).map((r) => r.value);
    // If the check itself failed, say nothing rather than guess.
    if (results.every((r) => r.status === "rejected")) return;

    const el = banner();
    const newest = times.length ? Math.max(...times) : NaN;
    const stale = !Number.isFinite(newest) || Date.now() - newest > STALE_HOURS * 3600 * 1000;
    if (!stale) { el.hidden = true; return; }
    const since = Number.isFinite(newest) ? ` The latest reading is from ${formatTime(newest)}.` : "";
    el.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = "Data delayed: ";
    el.appendChild(strong);
    el.appendChild(document.createTextNode(
      `FTS360 is not currently updating, so station data on this page is behind.${since} It will catch up automatically once FTS360 is back.`
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
