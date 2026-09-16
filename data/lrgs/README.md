# NOAA LRGS ingested data

Populated by `.github/workflows/lrgs-ingest.yml` every 15 minutes once
`LRGS_USER` + `LRGS_PASSWORD` secrets are configured. Read by
`netlify/functions/lrgs.mjs` and served at `/api/lrgs`.

Layout:

```
data/lrgs/
├── latest.json                # manifest: latest reading per station
├── README.md                  # this file
└── <station-id>/
    └── YYYYMMDDTHHMMSSZ.json  # one file per received transmission
```

**Do not hand-edit files here** — they are overwritten by the ingest bot.

To register for an LRGS account: call NOAA/Wallops DCS operator at
**(757) 824-7450** and request DDS access for real-time GOES DCP retrieval.
Provide name, email, org ("Parks Canada Visitor Safety"), phone, and a
6-character preferred username. Account propagates to all 4 public LRGS
servers (`cdadata.wcda.noaa.gov`, `cdabackup.wcda.noaa.gov`,
`lrgseddn1.cr.usgs.gov`, `lrgseddn2.cr.usgs.gov`) within 24 hours.
