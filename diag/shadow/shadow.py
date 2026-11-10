"""Shadow comparison of HN24 methods (Conlan, ISSW 2026) against the manual HN24 sheets.

Uses the production Python port (banff-winter-meeting scripts/sync_snow_sheet.py) for the
current ratchet and the gauge/RDPS-checked ratchet, so the numbers are what the code does.
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import math
import statistics as st
import sys
from bisect import bisect_left, bisect_right

sys.path.insert(0, "/home/claude/banff-winter-meeting/scripts")
import sync_snow_sheet as S  # noqa: E402

import os
BASE = os.environ.get("SHADOW_BASE", os.path.dirname(os.path.abspath(__file__)))
D = f"{BASE}/data/out"
M = f"{BASE}/manual"

TABS = {  # sheet key -> (depth station, gauge station or None, has own gauge)
    "sunshine": ("fts-sunshine", "fts-sunshine"),
    "simpson": ("fts-simplo", "fts-vermillion"),
    "boslo": ("fts-boslo", None),
    "bowsummit": ("fts-bowsummit", None),
    "stanley": ("fts-stanley", None),
}
NAMES = {"sunshine": "Sunshine", "simpson": "Simpson Lower", "boslo": "Bosworth Lower", "bowsummit": "Bow Summit", "stanley": "Stanley Lower"}
SEASONS = ["2024-25", "2025-26"]


def load(sid):
    recs = json.load(open(f"{D}/fts/{sid}.json"))
    recs.sort(key=lambda r: r["measurementDateTime"])
    return recs


def load_rdps(sid):
    out = []
    for y in (2023, 2024, 2025, 2026):
        try:
            out += S.rdps_points(json.load(open(f"{D}/rdps/{sid}-{y}.json")))
        except FileNotFoundError:
            pass
    out.sort()
    return out


def manual(key):
    vals = {}
    for season in SEASONS:
        for line in open(f"{M}/{season}-{key}.txt"):
            ym, v = line.split(":")
            y, m = map(int, ym.split("-"))
            for i, x in enumerate(v.strip().split(",")):
                if x != "":
                    vals[dt.date(y, m, i + 1)] = float(x)
    return vals


class Station:
    def __init__(self, key):
        self.key = key
        sid, gid = TABS[key]
        self.recs = load(sid)
        if gid is None:  # no gauge: strip the Rn_1 alias fields so the check is RDPS only (HN_NO_GAUGE_IDS)
            self.recs = [{**r, "precipTotal": None, "precipIncr": None} for r in self.recs]
            self.check = self.recs
        elif gid == sid:
            self.check = self.recs
        else:
            self.check = sorted(S.with_gauge(self.recs, load(gid)), key=lambda r: r["measurementDateTime"])
        self.t = [S._t(r).timestamp() for r in self.recs]
        self.tc = [S._t(r).timestamp() for r in self.check]
        self.rdps = load_rdps(sid)
        self.rt = [x for x, _ in self.rdps]

    def window(self, at, hours, check=False):
        ts, rs = (self.tc, self.check) if check else (self.t, self.recs)
        a = at.timestamp()
        return rs[bisect_left(ts, a - hours * 3600):bisect_right(ts, a)]

    def forecast(self, at):
        a = at.timestamp()
        return self.rdps[bisect_left(self.rt, a - 80 * 3600):bisect_right(self.rt, a + 3 * 3600)]


def median_at(pts, t, now):
    ys = sorted(v for x, v in pts if abs(x - t) <= 5400 and x <= now)
    if not ys:
        return None
    m = len(ys) // 2
    return ys[m] if len(ys) % 2 else (ys[m - 1] + ys[m]) / 2


def delta24(recs, at):
    pts = S._depth_points(recs, at - dt.timedelta(hours=26), at)
    a = at.timestamp()
    now, then = median_at(pts, a, a), median_at(pts, a - 86400, a)
    if now is None or then is None:
        return None
    return max(0.0, now - then)


def hourly(recs, at, hours=24):
    """Last valid HS reading in each hour [(hour index, cm)], spike filter as the explorer."""
    pts = S._depth_points(recs, at - dt.timedelta(hours=hours + 1), at)
    a = at.timestamp()
    byh = {}
    for x, v in pts:
        byh[math.floor((x - a) / 3600)] = v
    return sorted(byh.items())


def raw_sum(recs, at):
    h = hourly(recs, at)
    tot = 0.0
    for (i0, v0), (i1, v1) in zip(h, h[1:]):
        if i1 - i0 <= 2 and i1 >= -24:
            tot += max(0.0, v1 - v0)
    return tot if h else None


def gap_over_90(recs, at):
    pts = S._depth_points(recs, at - dt.timedelta(hours=24), at)
    if not pts:
        return True
    xs = [at.timestamp() - 86400] + [x for x, _ in pts] + [at.timestamp()]
    return any(b - a > 5400 for a, b in zip(xs, xs[1:]))


def qc_reject(recs, at):
    """Conlan's rate-of-change checks on the raw HS: drop a reading more than 10 cm from the previous
    accepted hour, 20 cm over 2 h or 30 cm over 3 h. Returns (filtered records, rejected count in 24 h)."""
    a = at.timestamp()
    acc: list[tuple[float, float]] = []
    keep, rejected = [], 0
    for r in recs:
        v = S._num(r.get("snowHeight"))
        x = S._t(r).timestamp()
        if v is None:
            keep.append(r)
            continue
        bad = False
        for lim, h in ((10, 1), (20, 2), (30, 3)):
            prev = [y for t, y in acc if x - h * 3600 - 900 <= t <= x - (h - 1) * 3600 - 900] if h > 1 else [y for t, y in acc if x - 3600 - 900 <= t < x]
            if prev and abs(v - prev[-1]) > lim:
                bad = True
        if bad:
            if x > a - 86400:
                rejected += 1
            keep.append({**r, "snowHeight": None})
        else:
            acc.append((x, v))
            keep.append(r)
    return keep, rejected


def min_temp(recs, at, hours):
    a = at.timestamp()
    vs = []
    for r in recs:
        x = S._t(r).timestamp()
        if a - hours * 3600 < x <= a:
            for f in ("airTempMin", "airTempAvg"):
                v = S._num(r.get(f))
                if v is not None:
                    vs.append(v)
                    break
    return min(vs) if vs else None


def max_temp(recs, at, hours=24):
    a = at.timestamp()
    vs = [S._num(r.get("airTempMax")) if S._num(r.get("airTempMax")) is not None else S._num(r.get("airTempAvg"))
          for r in recs if a - hours * 3600 < S._t(r).timestamp() <= a]
    vs = [v for v in vs if v is not None]
    return max(vs) if vs else None


_ORIG_CREDITS = S._hs_credits
WARM = {"hours": None, "temps": []}


GAP = {"s": 5400}


def _credits_gap(pts, half_s, frm, threshold=None):
    """S._hs_credits with the reference reset after a gap of GAP["s"] instead of 90 min."""
    credits, ref, last, seen = [], None, None, False
    for x, y in S._smoothed(pts, half_s):
        if last is not None and x - last > GAP["s"]:
            ref = None
        last = x
        if x > frm:
            seen = True
        if ref is None or y < ref:
            ref = y
        elif y - ref >= (threshold(x) if threshold else 2):
            gain = y - ref
            ref = y
            if gain <= 50:
                credits.append((x, gain))
    return credits, seen


def ratchet_gap(records, at):
    frm = (at - dt.timedelta(hours=24)).timestamp()
    pts = [p for p in S._depth_points(records, at - dt.timedelta(hours=30), at) if p[0] > frm - 6 * 3600]
    credits, seen = _credits_gap(pts, 5400, frm)
    return S._round1(sum(g for t, g in credits if t > frm)) if seen else None


def ratchet_step1(records, at, forecast):
    """Plain ratchet (no rejection), but a 1 cm step while RDPS expected >= 1 mm in t-6h..t+2h (suggestion 5)."""
    frm = (at - dt.timedelta(hours=24)).timestamp()
    pts = [p for p in S._depth_points(records, at - dt.timedelta(hours=30), at) if p[0] > frm - 6 * 3600]
    def thr(t):
        f = S._forecast_between(forecast, t - 6 * 3600, t + 2 * 3600)
        return 1 if f is not None and f >= 1 else 2
    credits, seen = _credits_gap(pts, 5400, frm, thr)
    return S._round1(sum(g for t, g in credits if t > frm)) if seen else None


def _gated_credits(pts, half_s, frm, threshold=None):
    credits, seen = _credits_gap(pts, half_s, frm, threshold)
    h = WARM["hours"]
    if h is None:
        return credits, seen
    temps = WARM["temps"]
    out = []
    for t, g in credits:
        vs = [v for x, v in temps if t - h * 3600 <= x <= t]
        if vs and min(vs) > 0:
            continue  # warm spell: depth rise not credited (the ratchet reference still moves, as for a gauge-rejected rise)
        out.append((t, g))
    return out, seen


S._hs_credits = _gated_credits


def temps_of(recs):
    out = []
    for r in recs:
        v = S._num(r.get("airTempAvg"))
        if v is not None:
            out.append((S._t(r).timestamp(), v))
    return out


def run():
    rows = []
    for key in TABS:
        stn = Station(key)
        man = manual(key)
        for d in sorted(man):
            at = dt.datetime.combine(d, dt.time(7), S.MOUNTAIN)
            w = stn.window(at, 80)
            if not any(S._num(r.get("snowHeight")) is not None and at.timestamp() - 86400 < S._t(r).timestamp() <= at.timestamp() for r in w):
                continue
            wc = stn.window(at, 80, check=True)
            fc = stn.forecast(at)
            ratchet = S.hn24_from_depth(w, at)
            checked, state = S.hn24_gauge_checked(wc, at, fc)
            # explorer runs the check at every depth station; the sheet sync only at Sunshine and Simpson
            sheet_sync = checked if key in ("sunshine", "simpson") else ratchet
            delta = delta24(w, at)
            rs = raw_sum(w, at)
            comb = None if rs is None or delta is None else (rs + delta) / 2
            qc_w, rej = qc_reject(wc, at)
            checked_qc, _ = S.hn24_gauge_checked(qc_w, at, fc)
            mins = {h: min_temp(w, at, h) for h in (6, 12, 24)}
            gated = {h: (delta if (mins[h] is not None and mins[h] > 0 and delta is not None) else checked) for h in (6, 12, 24)}
            WARM["temps"] = temps_of(w)
            hourly_gate = {}
            for h in (3, 6, 12):
                WARM["hours"] = h
                hourly_gate[h] = S.hn24_gauge_checked(wc, at, fc)[0]
            WARM["hours"] = None
            bridge = {}
            for gh in (6, 12, 1000):
                GAP["s"] = gh * 3600
                bridge[gh] = (ratchet_gap(w, at), S.hn24_gauge_checked(wc, at, fc)[0], S.hn24_gauge_checked(qc_w, at, fc)[0])
            GAP["s"] = 5400
            step1 = ratchet_step1(w, at, fc)
            GAP["s"] = 12 * 3600
            step1_b12 = ratchet_step1(w, at, fc)
            GAP["s"] = 5400
            hw = None
            if TABS[key][1]:
                g = [r for r in wc if S._num(r.get("precipTotal")) is not None or S._num(r.get("precipIncr")) is not None]
                hw = S.hw24_from_gauge(g, at) if g else None
            rdps24 = S._forecast_between(fc, at.timestamp() - 86400, at.timestamp())
            rows.append({
                "station": key, "date": d.isoformat(), "manual": man[d],
                "ratchet": ratchet, "checked": checked, "sheet_sync": sheet_sync, "state": state,
                "delta": delta, "raw_sum": rs, "combined": comb, "checked_qc": checked_qc, "qc_rejected": rej,
                "gate6": gated[6], "gate12": gated[12], "gate24": gated[24], "hgate3": hourly_gate[3], "hgate6": hourly_gate[6], "hgate12": hourly_gate[12], "step1": step1, "step1_bridge12": step1_b12,
                **{f"{n}_bridge{gh}": bridge[gh][i] for gh in bridge for i, n in enumerate(("ratchet", "checked", "checked_qc"))},
                "tmin6": mins[6], "tmin12": mins[12], "tmin24": mins[24], "tmax24": max_temp(w, at),
                "gap": gap_over_90(w, at), "hw24": hw, "rdps24": rdps24,
            })
        print(key, len([r for r in rows if r["station"] == key]), file=sys.stderr)
    json.dump(rows, open(f"{BASE}/shadow_rows.json", "w"))


if __name__ == "__main__":
    run()
