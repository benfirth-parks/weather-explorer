import { getStore } from "@netlify/blobs";

const STORE_NAME = "weather-explorer-analytics-v1";
const MAX_DAYS = 366;
const MAX_EVENTS = 50_000;

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function parseDays(value) {
  const days = Number(value || 30);
  return Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? days : 30;
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function topEntries(object, limit = 12) {
  return Object.entries(object)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function average(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export default async (request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { Allow: "GET", "Content-Type": "application/json" }
    });
  }

  if (!process.env.ANALYTICS_ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Analytics admin token is not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (request.headers.get("x-analytics-admin-token") !== process.env.ANALYTICS_ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const url = new URL(request.url);
    const days = parseDays(url.searchParams.get("days"));
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const store = getStore(STORE_NAME);
    const events = [];

    for (let index = 0; index < days && events.length < MAX_EVENTS; index += 1) {
      const date = new Date(now.getTime() - index * 86_400_000);
      const listed = await store.list({ prefix: `events/${dayKey(date)}/` });

      for (const blob of listed.blobs) {
        if (events.length >= MAX_EVENTS) break;
        const event = await store.get(blob.key, { type: "json" });
        const occurredAt = new Date(event?.occurredAt).getTime();
        if (event && Number.isFinite(occurredAt) && occurredAt >= cutoff.getTime()) {
          events.push(event);
        }
      }
    }

    const visitors = new Set();
    const daily = {};
    const eventCounts = {};
    const stations = {};
    const ranges = {};
    const metrics = {};
    const devices = {};
    const referrers = {};
    const statuses = {};
    const durations = [];

    for (const event of events) {
      if (event.visitorId) visitors.add(event.visitorId);
      increment(daily, String(event.occurredAt || "").slice(0, 10));
      increment(eventCounts, event.event);
      increment(stations, event.stationId);
      increment(ranges, event.range);
      increment(metrics, event.metric);
      increment(devices, event.device);
      increment(referrers, event.referrerHost || "Direct / unknown");
      increment(statuses, event.status);
      if (Number.isFinite(event.durationMs)) durations.push(event.durationMs);
    }

    const archiveRequests = eventCounts.archive_request || 0;
    const archiveErrors = eventCounts.archive_error || 0;

    return Response.json({
      generatedAt: now.toISOString(),
      days,
      limited: events.length >= MAX_EVENTS,
      summary: {
        events: events.length,
        pageViews: eventCounts.page_view || 0,
        uniqueVisitors: visitors.size,
        stationSelections: eventCounts.station_selected || 0,
        archiveRequests,
        archiveErrors,
        archiveErrorRate: archiveRequests ? Math.round((archiveErrors / archiveRequests) * 10_000) / 100 : 0,
        averageArchiveRequestMs: average(durations)
      },
      daily: Object.entries(daily)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      events: topEntries(eventCounts),
      stations: topEntries(stations),
      ranges: topEntries(ranges),
      metrics: topEntries(metrics),
      devices: topEntries(devices),
      referrers: topEntries(referrers),
      archiveStatuses: topEntries(statuses)
    });
  } catch (error) {
    console.error("Analytics report error", error);
    return new Response(JSON.stringify({ error: "Analytics report unavailable" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
