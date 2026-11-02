import json, os, urllib.request, datetime as dt
os.makedirs("diag-data/avcan", exist_ok=True)
now = dt.datetime.now(dt.timezone.utc)
for sid in (124, 125, 126, 129, 123):
    for k in range(2):
        a = now - dt.timedelta(days=7 * (k + 1)); b = now - dt.timedelta(days=7 * k)
        u = f"https://weather.prod.avalanche.ca/stations/{sid}/measurements?fromDate={a.isoformat()}&toDate={b.isoformat()}"
        try:
            with urllib.request.urlopen(u, timeout=60) as r:
                open(f"diag-data/avcan/{sid}-{k}.json", "wb").write(r.read())
            print("ok", sid, k)
        except Exception as e:
            print("fail", sid, k, e)
