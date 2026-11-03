/* Site watchdog, run by .github/workflows/site-watchdog.yml.

   Checks from outside Netlify that the site is up and that its own hourly
   health check is still running. Each problem becomes one GitHub issue
   (labelled site-alert, mentioning the owner so GitHub emails them); when the
   problem clears the issue gets a "Resolved" comment and is closed, which
   emails again. While RESEND_API_KEY is not set on Netlify, the hourly
   check's own incidents (data not updating, a feed down) are raised here too.

   Env: GITHUB_TOKEN, GITHUB_REPOSITORY, SITE_URL, ALERT_MENTION. */

const SITE = (process.env.SITE_URL || "https://rockiesweatherdataexplorer.netlify.app").replace(/\/$/, "");
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const MENTION = process.env.ALERT_MENTION || "";
const LABEL = "site-alert";
const H = 3600 * 1000;
const HEALTH_STALE_HOURS = 3;
const DRY_RUN = process.env.DRY_RUN === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (err) { last = err; }
    if (i < tries - 1) await sleep(20000);
  }
  throw last;
}

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const marker = (key) => `<!-- site-alert:${key} -->`;
const keyOf = (body) => (String(body || "").match(/<!-- site-alert:([\w:-]+) -->/) || [])[1];

function mtNow() {
  const d = new Date(Date.now() - 6 * H);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} MT`;
}

async function collectProblems() {
  const problems = [];

  // The pages themselves answer "Not found" outside Canada (parks-access edge
  // function) and GitHub's runners are in the US, so check a static file the
  // access check leaves open: if Netlify serves it, the site is up.
  try {
    await fetchRetry(`${SITE}/data/lrgs/latest.json`);
  } catch (err) {
    problems.push({
      key: "site-down",
      title: "Site is not loading",
      detail: `${SITE} did not answer after 3 tries over about a minute (${err?.message || err}). Check Netlify for an outage or a failed deploy.`
    });
    return problems; // nothing else can be checked
  }

  let health = null;
  try {
    health = await (await fetchRetry(`${SITE}/api/site-health`)).json();
  } catch (err) {
    problems.push({
      key: "health-check-down",
      title: "Site health check is not answering",
      detail: `${SITE}/api/site-health failed (${err?.message || err}), so data and feed problems cannot be checked.`
    });
    return problems;
  }

  const last = new Date(health.lastRunAt || NaN).getTime();
  if (!Number.isFinite(last) || Date.now() - last > HEALTH_STALE_HOURS * H) {
    problems.push({
      key: "health-check-down",
      title: "Site's hourly health check has stopped running",
      detail: `The hourly site-health-check function on Netlify last ran ${health.lastRunAt || "never"}. Scheduled functions on Netlify may have stopped, which usually means the station sync has stopped too.`
    });
  }

  // Mirror the hourly check's incidents unless it already emails them itself.
  if (!health.emailConfigured) {
    for (const [key, inc] of Object.entries(health.incidents || {})) {
      problems.push({ key: `data:${key}`, title: inc.title, detail: inc.detail });
    }
  }
  return problems;
}

async function main() {
  const problems = await collectProblems();
  console.log(JSON.stringify({ problems }, null, 2));
  if (DRY_RUN) return;

  const open = await gh(`/issues?state=open&labels=${LABEL}&per_page=100`);
  const openByKey = new Map(open.filter((i) => !i.pull_request).map((i) => [keyOf(i.body), i]));
  const want = new Map(problems.map((p) => [p.key, p]));

  for (const [key, p] of want) {
    if (openByKey.has(key)) continue;
    const body = `${MENTION ? `${MENTION} ` : ""}${p.detail}\n\nFirst seen ${mtNow()} by the site watchdog. This issue closes itself, with one more notification, when the problem clears.\n\n${SITE}\n\n${marker(key)}`;
    const issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: `Site alert: ${p.title}`, body, labels: [LABEL] }) });
    console.log(`Opened #${issue.number} for ${key}`);
  }

  for (const [key, issue] of openByKey) {
    if (!key || want.has(key)) continue;
    await gh(`/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `${MENTION ? `${MENTION} ` : ""}Resolved: this has cleared as of ${mtNow()}.` })
    });
    await gh(`/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`Closed #${issue.number} for ${key}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
