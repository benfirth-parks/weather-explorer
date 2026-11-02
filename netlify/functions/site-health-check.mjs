import { schedule } from "@netlify/functions";
import { runHealthCheck } from "./_site-health.mjs";

/* Hourly at 45 past (half an hour after the station sync). Opens or closes
   site-health incidents and emails them when Resend is set up. See
   _site-health.mjs. */
async function handler() {
  const result = await runHealthCheck();
  console.log(JSON.stringify({ event: "site-health", ...result }));
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

export default schedule("45 * * * *", handler);
