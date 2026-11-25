"""Diag only: pull raw GOES messages for arbitrary DCP addresses (diag-in/addrs.txt)."""
import json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import lrgs_ingest as L

addrs = [a.strip().upper() for a in Path("diag-in/addrs.txt").read_text().split() if a.strip()]
since = os.environ.get("SINCE", "now - 7 days")
out = Path("diag-out"); out.mkdir(exist_ok=True)
user, pw = os.environ["LRGS_USER"], os.environ["LRGS_PASSWORD"]
msgs = None
for host in L.FAILOVER_SERVERS:
    c = L.LRGSClient(host, 16003, user, pw)
    try:
        c.connect(); c.send_criteria(L.build_search_criteria(addrs, since))
        msgs = c.read_all(max_seconds=900); print("got", len(msgs), "from", host); break
    except Exception as e:
        print(host, "failed", e)
    finally:
        c.close()
with open(out / "messages.jsonl", "w") as f:
    for raw in msgs or []:
        d = L.decode_message(raw); d.pop("raw_values_18bit", None)
        f.write(json.dumps(d) + "\n")
