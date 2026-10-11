import { getStore } from "@netlify/blobs";

// One day's page views and visitors, for the App Portal's history import.
// The full report reads every event in its range in one call, which is too
// slow for a year of history; this reads a single day, in parallel, and
// caches finished days so repeat imports are quick.

const STORE_NAME = "weather-explorer-analytics-v1";
const BATCH = 100;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function countDay(store, date) {
  const { blobs } = await store.list({ prefix: `events/${date}/` });
  let views = 0;
  const visitors = new Set();
  for (let i = 0; i < blobs.length; i += BATCH) {
    const events = await Promise.all(
      blobs.slice(i, i + BATCH).map((blob) => store.get(blob.key, { type: "json" }).catch(() => null))
    );
    for (const event of events) {
      if (event?.event !== "page_view") continue;
      views += 1;
      if (event.visitorId) visitors.add(event.visitorId);
    }
  }
  return { date, views, visitors: visitors.size, events: blobs.length };
}

export default async (request) => {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!process.env.ANALYTICS_ADMIN_TOKEN) return json({ error: "Analytics admin token is not configured" }, 503);
  if (request.headers.get("x-analytics-admin-token") !== process.env.ANALYTICS_ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return json({ error: "date must be YYYY-MM-DD" }, 422);
  }

  try {
    const store = getStore(STORE_NAME);
    const finished = date < new Date().toISOString().slice(0, 10);
    if (finished) {
      const cached = await store.get(`daily/${date}`, { type: "json" });
      if (cached) return json(cached);
    }
    const day = await countDay(store, date);
    if (finished) await store.setJSON(`daily/${date}`, day);
    return json(day);
  } catch (error) {
    return json({ error: error.message || "Could not read analytics" }, 500);
  }
};
