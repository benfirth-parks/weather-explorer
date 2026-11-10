import json, statistics as st, sys, datetime as dt
from collections import defaultdict
import os
BASE = os.environ.get("SHADOW_BASE", os.path.dirname(os.path.abspath(__file__)))
rows = json.load(open(f"{BASE}/shadow_rows.json"))
METHODS = ["sheet_sync", "checked", "ratchet", "delta", "raw_sum", "combined", "gate6", "hgate3", "hgate6", "hgate12", "checked_qc"]
NAMES = {"sunshine": "Sunshine", "simpson": "Simpson Lower", "boslo": "Bosworth Lower", "bowsummit": "Bow Summit", "stanley": "Stanley Lower"}


def cls(r):
    p = r["hw24"] if r["hw24"] is not None else r["rdps24"]
    if p is not None and p >= 2:
        return "storm"
    if r["tmax24"] is not None and r["tmax24"] > 0:
        return "warm"
    return "dry_cold"


def stats(rs, m):
    e = [round(r[m] + 1e-9) - r["manual"] for r in rs if r[m] is not None]
    if not e:
        return None
    return {"n": len(e), "me": st.mean(e), "mae": st.mean(abs(x) for x in e), "off5": sum(abs(x) >= 5 for x in e)}


def table(rs, title):
    print(f"\n## {title} (n={len(rs)})")
    print(f"{'method':12} {'n':>4} {'ME':>6} {'MAE':>6} {'>=5':>4}")
    for m in METHODS:
        s = stats(rs, m)
        if s:
            print(f"{m:12} {s['n']:4} {s['me']:6.2f} {s['mae']:6.2f} {s['off5']:4}")


if "--align" in sys.argv:
    by = defaultdict(dict)
    for r in rows:
        by[r["station"]][r["date"]] = r
    for k, d in by.items():
        for off in (-1, 0, 1):
            e = []
            for ds, r in d.items():
                o = d.get((dt.date.fromisoformat(ds) + dt.timedelta(days=off)).isoformat())
                if o and o["checked"] is not None:
                    e.append(abs(o["checked"] - r["manual"]))
            print(k, off, round(st.mean(e), 2), len(e))
    sys.exit()

table(rows, "All stations, all days")
for c in ("storm", "dry_cold", "warm"):
    table([r for r in rows if cls(r) == c], f"All stations, {c}")
for k in NAMES:
    rs = [r for r in rows if r["station"] == k]
    table(rs, f"{NAMES[k]}, all days")
    for c in ("storm", "dry_cold", "warm"):
        table([r for r in rs if cls(r) == c], f"{NAMES[k]}, {c}")
