import { getStore } from "@netlify/blobs";

const STORE_NAME = "weather-explorer-analytics-v1";
const ALLOWED_EVENTS = new Set([
  "page_view",
  "station_selected",
  "station_group_changed",
  "time_range_changed",
  "metric_changed",
  "refresh_clicked",
  "archive_request",
  "archive_error"
]);
const MAX_EVENT_BYTES = 2_000;
const MAX_EVENTS_PER_DAY = 10_000;

function safeString(value, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function safeNumber(value, min, max) {
  const number = Number(value);

  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function eventKey(date, visitorId) {
  return `events/${dayKey(date)}/${date.toISOString()}-${visitorId}-${crypto.randomUUID()}.json`;
}

function normalizeEvent(payload) {
  const event = safeString(payload?.event, 64);
  const visitorId = safeString(payload?.visitorId, 80);

  if (!event || !ALLOWED_EVENTS.has(event) || !visitorId) {
    return null;
  }

  return {
    event,
    visitorId,
    stationId: safeString(payload.stationId, 64),
    metric: safeString(payload.metric, 64),
    range: safeString(payload.range, 32),
    page: safeString(payload.page, 120) || "/",
    group: safeNumber(payload.group, 1, 10),
    status: safeString(payload.status, 32),
    durationMs: safeNumber(payload.durationMs, 0, 120_000),
    device: safeString(payload.device, 20),
    referrerHost: safeString(payload.referrerHost, 120),
    occurredAt: new Date().toISOString()
  };
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json"
      }
    });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);

    if (contentLength > MAX_EVENT_BYTES) {
      return new Response(JSON.stringify({ error: "Event payload too large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" }
      });
    }

    const event = normalizeEvent(await request.json());

    if (!event) {
      return new Response(JSON.stringify({ error: "Invalid analytics event" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const store = getStore(STORE_NAME);
    const listed = await store.list({ prefix: `events/${dayKey()}/` });

    if (listed.blobs.length >= MAX_EVENTS_PER_DAY) {
      return new Response(null, { status: 202 });
    }

    await store.setJSON(
      eventKey(new Date(event.occurredAt), event.visitorId),
      event
    );

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Analytics event error", error);

    return new Response(JSON.stringify({ error: "Analytics event unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
