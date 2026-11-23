# STATUS — Rockies Weather Explorer

Last updated: 2026-11-23 · Owner: Ben Firth (Parks Canada Visitor Safety, Banff)
Master list: "AI Projects – Master List" sheet (Group: Weather, Status: Live)

## What it is
Serverless FTS360 weather dashboard for 26 Canadian Rockies stations.
Live: https://rockiesweatherdataexplorer.netlify.app (deploys from `main`).
Its sibling is the K Country site (repo `benfirth-parks/kcountry-wx-actuals`). Ben calls
the two of them "the sites that collect weather actuals", and changes often apply to both.

## Stack
- `index.html` (desktop) and `mobile.html`, with shared assets in `assets/`
- Netlify Functions in `netlify/functions/`, multi-year archive in Netlify Blobs (`rockies-weather-archive-v1`)
- Refresh layers: Netlify schedule, GitHub Actions half-hourly fallback (`.github/workflows/`), cron-job.org, inline repair
- Cached AI summary: 30 min cache, 110-word ceiling

## Open items
- Show the hourly-data table on expanded station graphs by default, with no click needed (here and on the K Country and Jasper pages).
- NOAA MADIS is under evaluation. Stay on FTS until a side-by-side validation is done.

## How to work in this repo
- Don't change working UI or behaviour unless Ben asks.
- Show the diff first, then commit to `main` and deploy. No manual pasting of files, including `.github/workflows/`.
- Keep source diagnosis and chart work separate. Confirm exact file contents before diagnosing, and never infer station IDs.
- Use free, keyless data sources over paid APIs.
- Give short, concrete, step-by-step answers.
