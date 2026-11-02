import { fetchNoaaRecords } from "../netlify/functions/_lrgs.mjs";
const t = Date.now();
const out = await fetchNoaaRecords({ sinceHours: Number(process.env.H || 3) });
console.log("NODE host", out.host, "messages", out.messageCount, "ms", Date.now() - t);
for (const [k, v] of [...out.byStation].sort()) console.log("NODE", k, v.length, JSON.stringify(v.at(-1)));
