#!/usr/bin/env python3
"""
One-shot importer: pushes an FTS360 CSV export into the site's Netlify
Blobs archive via /api/import-historical.

Usage:
    ARCHIVE_ADMIN_TOKEN=<token> python3 scripts/import_historical_csv.py \
        --csv path/to/ALL-STATIONS.csv \
        [--site https://rockiesweatherdataexplorer.netlify.app] \
        [--chunk-size 10000] \
        [--only fts-boslo,fts-bowsummit] \
        [--dry-run]

Timezone: source CSV timestamps are naive MST (UTC-7, no DST) — verified
against a live-archive overlap window. All rows are converted to UTC ISO
strings before upload.

Schema: archive schema is intentionally unchanged. Only the fields
already tracked (airTempAvg, airTempMin, airTempMax, snowHeight, newSnow)
are exported. Extras (Vb, SigStrength, etc.) are discarded.

Overlap policy: import endpoint honours EXISTING WINS — any existing
record for the same timestamp is kept and the CSV row is dropped.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

# ---------------------------------------------------------------------------
# CSV StationName -> archive stationId mapping.
# 21 of 25 CSV stations map to existing site IDs; the rest are excluded
# per user instruction (Waterton x4, Parker Upper, Yoho).
# ---------------------------------------------------------------------------
NAME_TO_ID = {
    "Avi - BYK Bosworth Lower":              "fts-boslo",
    "Avi - BYK Bosworth Upper":              "fts-bosup",
    "Avi - BYK Bow Summit":                  "fts-bowsummit",
    "Avi - BYK Bow Summit Precip Gauge":     "fts-bowprecip",
    "Avi - BYK Lookout":                     "fts-lookout",
    "Avi - BYK Simpson Lower":               "fts-simplo",
    "Avi - BYK Simpson Upper":               "fts-simpup",
    "Avi - BYK Stanley Lower":               "fts-stanley",
    "Avi - BYK Sunshine Village":            "fts-sunshine",
    "Avi - BYK Vulture Peak":                "fts-vulture",
    "Avi - BYK Whymper":                     "fts-whymper",
    "Avi - JNP Coleman":                     "fts-coleman",
    "Avi - JNP Tangle Ridge":                "fts-tangleridge",
    "Fire - LLYK Boulder":                   "fts-boulder",
    "Fire - LLYK Lake Louise":               "fts-lakelouise",
    "Fire - LLYK Saskatchewan Crossing":     "fts-saskcrossing",
    "Fire - LLYK Vermillion Crossing":       "fts-vermillion",
    "Pika Run":                              "fts-pikarun",
    "Skoki":                                 "fts-skoki",
    # These are explicitly excluded (Waterton x4, Parker, Yoho, and the
    # 5 "disregard" stations that would still be here in the CSV are
    # excluded either by absence from this map or by SKIP_IDS below):
    #   Waterton Akamina Pass / Summit Lake / Bertha Mid / Bertha Ridge
    #   Avi - JNP Parker Upper
    #   Yoho (EnvCan)
}

# Explicit skip list — from user's "disregard jasper stations" instruction.
# fts-tangleridge is telemetry-only in the CSV (no weather data) so
# it would be filtered out naturally, but list it here for clarity.
# fts-saskcrossing DOES have data in the CSV and MUST be filtered here.
SKIP_IDS: set[str] = {
    "fts-jasperqd1", "fts-dorothy", "fts-saskcrossing",
    "fts-bigbend", "fts-tangleridge",
}

# CSV -> archive field mapping. Only these fields are exported.
# Values are numeric; empty / missing become skipped fields (not null).
FIELD_MAP = {
    "Temp":         "airTempAvg",
    "Min_Temp_24hr":"airTempMin",
    "Mx_Temp_24hr": "airTempMax",
    "HS":           "snowHeight",
    "HN24":         "newSnow",
}

# MST is fixed at UTC-7 (no DST) per user's project-wide convention.
MST = timezone(timedelta(hours=-7))


def parse_mst_dt(s: str) -> datetime | None:
    """Parse e.g. '9/9/2026 23:00' as naive MST and return UTC-aware datetime."""
    s = s.strip()
    if not s:
        return None
    try:
        dt = datetime.strptime(s, "%m/%d/%Y %H:%M")
    except ValueError:
        try:
            dt = datetime.strptime(s, "%m/%d/%Y %H:%M:%S")
        except ValueError:
            return None
    return dt.replace(tzinfo=MST).astimezone(timezone.utc)


def to_iso_z(dt: datetime) -> str:
    """Match the archive's Date.prototype.toISOString() format exactly:
    2024-01-01T07:00:00.000Z"""
    # datetime.isoformat() gives 2024-01-01T07:00:00+00:00 — we need the
    # .000Z suffix.
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def as_number(raw: str) -> float | None:
    raw = (raw or "").strip()
    if not raw or raw in ("/////", "///"):
        return None
    try:
        v = float(raw.replace(",", ""))
    except ValueError:
        return None
    return v


def rows_by_station(csv_path: Path) -> Iterator[tuple[str, dict]]:
    """Yield (stationId, record) for every convertible CSV row.

    Rows for stations not in NAME_TO_ID are silently skipped.
    """
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            name = (row.get("StationName") or "").strip()
            sid = NAME_TO_ID.get(name)
            if not sid or sid in SKIP_IDS:
                continue
            dt = parse_mst_dt(row.get("DateTime") or "")
            if not dt:
                continue
            rec = {"measurementDateTime": to_iso_z(dt)}
            for csv_col, arch_field in FIELD_MAP.items():
                v = as_number(row.get(csv_col, ""))
                if v is not None:
                    rec[arch_field] = v
            # Row must contain at least one measurement, not just a timestamp.
            if len(rec) < 2:
                continue
            yield sid, rec


def post_chunk(site: str, token: str, station_id: str,
               observations: list[dict], attempt: int = 1) -> dict:
    url = f"{site.rstrip('/')}/api/import-historical"
    body = json.dumps({"stationId": station_id,
                       "observations": observations}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "content-type": "application/json",
        "x-admin-token": token,
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(
            f"HTTP {e.code} from {url}: {detail}"
        ) from None
    except urllib.error.URLError as e:
        if attempt < 3:
            time.sleep(2 * attempt)
            return post_chunk(site, token, station_id, observations, attempt + 1)
        raise RuntimeError(f"Network error posting to {url}: {e}") from None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--csv", required=True, type=Path)
    p.add_argument("--site", default="https://rockiesweatherdataexplorer.netlify.app")
    p.add_argument("--chunk-size", type=int, default=10000,
                   help="Rows per POST (endpoint hard-caps at 20000)")
    p.add_argument("--only", default="",
                   help="Comma-separated station IDs to import (default: all)")
    p.add_argument("--dry-run", action="store_true",
                   help="Parse and group but do NOT POST anything")
    args = p.parse_args()

    token = os.environ.get("ARCHIVE_ADMIN_TOKEN", "").strip()
    if not args.dry_run and not token:
        print("ERROR: set ARCHIVE_ADMIN_TOKEN in the environment", file=sys.stderr)
        return 2

    only = set(s.strip() for s in args.only.split(",") if s.strip())

    # Group rows by station in memory. At ~50MB / 500k rows the whole
    # thing comfortably fits.
    by_station: dict[str, list[dict]] = {}
    total_read = 0
    total_kept = 0
    for sid, rec in rows_by_station(args.csv):
        total_read += 1
        if only and sid not in only:
            continue
        by_station.setdefault(sid, []).append(rec)
        total_kept += 1

    # Deduplicate per-station on measurementDateTime (CSV occasionally
    # double-lists a timestamp) — keep the LAST occurrence.
    for sid, rows in by_station.items():
        seen: dict[str, dict] = {}
        for r in rows:
            seen[r["measurementDateTime"]] = r
        by_station[sid] = sorted(seen.values(), key=lambda r: r["measurementDateTime"])

    print(f"CSV rows scanned:  {total_read:,}")
    print(f"After station filter: {total_kept:,}")
    print(f"Unique stations to import: {len(by_station)}")
    for sid in sorted(by_station):
        rows = by_station[sid]
        print(f"  {sid:22s}  {len(rows):>7,}  "
              f"{rows[0]['measurementDateTime']} -> {rows[-1]['measurementDateTime']}")

    if args.dry_run:
        print("\n(dry-run — nothing posted)")
        return 0

    print()
    grand_added = 0
    grand_overlap = 0
    grand_dropped_ret = 0
    for sid in sorted(by_station):
        rows = by_station[sid]
        n_chunks = (len(rows) + args.chunk_size - 1) // args.chunk_size
        added = overlap = dropped_ret = invalid = 0
        after = 0
        for i in range(n_chunks):
            chunk = rows[i * args.chunk_size:(i + 1) * args.chunk_size]
            print(f"  [{sid}]  chunk {i+1}/{n_chunks}  ({len(chunk)} rows)...",
                  end=" ", flush=True)
            t0 = time.time()
            try:
                res = post_chunk(args.site, token, sid, chunk)
            except Exception as e:
                print(f"FAIL  {e}")
                return 1
            dt = time.time() - t0
            added += res.get("newlyAdded", 0)
            overlap += res.get("overlapKeptExisting", 0)
            dropped_ret += res.get("droppedByRetention", 0)
            invalid += res.get("droppedInvalid", 0)
            after = res.get("totalAfter", after)
            print(f"OK  +{res.get('newlyAdded',0)} kept-existing:{res.get('overlapKeptExisting',0)} "
                  f"retained-after:{after}  ({dt:.1f}s)")
        print(f"  [{sid}]  DONE  added={added:,}  kept-existing={overlap:,}  "
              f"dropped-by-retention={dropped_ret:,}  invalid={invalid:,}  "
              f"archive_after={after:,}")
        grand_added += added
        grand_overlap += overlap
        grand_dropped_ret += dropped_ret
        print()

    print(f"GRAND TOTAL  new-rows-added:{grand_added:,}  "
          f"overlap-kept-existing:{grand_overlap:,}  "
          f"dropped-by-retention:{grand_dropped_ret:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
