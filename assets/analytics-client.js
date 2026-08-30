const ENDPOINT = "/.netlify/functions/analytics-event";
const VISITOR_KEY = "rockies-weather-explorer-anonymous-id";

function anonymousVisitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function deviceCategory() {
  const width = window.innerWidth || document.documentElement.clientWidth;
  if (width < 768) return "mobile";
  if (width < 1100) return "tablet";
  return "desktop";
}

function referrerHost() {
  try {
    return document.referrer ? new URL(document.referrer).hostname : null;
  } catch {
    return null;
  }
}

export function track(event, details = {}) {
  const payload = JSON.stringify({
    event,
    visitorId: anonymousVisitorId(),
    page: location.pathname || "/",
    device: deviceCategory(),
    referrerHost: referrerHost(),
    ...details
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
    return;
  }

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

export function trackArchiveRequest(details = {}) {
  track("archive_request", details);
}

export function trackArchiveError(details = {}) {
  track("archive_error", details);
}

track("page_view");
