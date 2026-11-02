"""Temporary: pull LRGS history for every known address + FTS archive for comparison."""
import json, os, sys, urllib.request
sys.path.insert(0, "scripts")
import lrgs_ingest as L

out = "diag-data"; os.makedirs(out + "/fts", exist_ok=True)
since = os.environ.get("SINCE", "now - 14 days")
c = L.LRGSClient(os.environ.get("LRGS_SERVER", "cdadata.wcda.noaa.gov"), 16003,
                 os.environ["LRGS_USER"], os.environ["LRGS_PASSWORD"])
c.connect()
c.send_criteria(L.build_search_criteria(L.STATIONS.keys(), since))
msgs = c.read_all(max_seconds=1500)
c.close()
print("messages", len(msgs))
with open(out + "/lrgs.jsonl", "w") as f:
    for raw in msgs:
        d = L.decode_message(raw)
        d.pop("raw_values_18bit", None)
        d["raw_hdr"] = raw[:37].decode("ascii", "replace")
        f.write(json.dumps(d) + "\n")
ids = sorted(set(L.STATIONS.values()) | {"fts-tangleridge"})
for sid in ids:
    try:
        with urllib.request.urlopen(f"https://rockiesweatherdataexplorer.netlify.app/api/fts?station={sid}&hours=400", timeout=90) as r:
            open(f"{out}/fts/{sid}.json", "wb").write(r.read())
        print("fts ok", sid)
    except Exception as e:
        print("fts fail", sid, e)
