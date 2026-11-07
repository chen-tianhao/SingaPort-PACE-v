"""Fix round: remove first block row on PPT2/3/5/6 quays, drop MAY building,
restore five blocks around the MAY."""
import json
import math
from collections import defaultdict

P = r"E:\github_code\SingaPort-PACE-v\data\ppt_terminal.json"
D = json.load(open(P, encoding="utf-8"))
import subprocess
HEAD = json.loads(subprocess.check_output(
    ["git", "-C", r"E:\github_code\SingaPort-PACE-v", "show", "f1b72e0:data/ppt_terminal.json"]
).decode("utf-8"))
CHAIN = [tuple(p) for p in D["quay_chains"][0]["pts"]]
SEGS = list(zip(CHAIN, CHAIN[1:]))
ALLOWED = {2, 3, 4, 7, 11, 13, 14}

# restore five blocks
want = ["Y173b", "Y181b", "Y189b", "Y190a", "Y222a"]
hc = {y["id"]: y for y in HEAD["yards"]}
have = {y["id"] for y in D["yards"]}
for yid in want:
    if yid not in have and yid in hc:
        D["yards"].append(hc[yid])
print("restored", [y for y in want if y in {x["id"] for x in D["yards"]}])

D["sheds"] = []


def proj(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    q = (a[0] + dx * t, a[1] + dz * t)
    return math.hypot(p[0] - q[0], p[1] - q[1])


def nearest(p):
    best = None
    for i, (a, b) in enumerate(SEGS):
        d = proj(p, a, b)
        if best is None or d < best[1]:
            best = (i, d)
    return best


groups = defaultdict(list)
for y in D["yards"]:
    i, d = nearest(y["c"])
    if i in ALLOWED:
        groups[i].append((d, y))

drop = set()
for i, g in groups.items():
    dmin = min(x[0] for x in g)
    for d, y in g:
        if d < dmin + 24:
            drop.add(y["id"])
print("first-row drop", len(drop), {i: sum(1 for d, y in g if y["id"] in drop) for i, g in groups.items()})

before = len(D["yards"])
D["yards"] = [y for y in D["yards"] if y["id"] not in drop]
D["meta"]["yards"] = len(D["yards"])
yc = sum(y["yc"] for y in D["yards"])
D["equipment"]["yard_cranes"]["total"] = yc
D["equipment"]["yard_cranes"]["rtg"] = sum(y["yc"] for y in D["yards"] if y["crane"] == "RTG")
D["equipment"]["yard_cranes"]["rmg"] = sum(y["yc"] for y in D["yards"] if y["crane"] == "RMG")
print(f"blocks {before} -> {len(D['yards'])}, cranes {yc}")
json.dump(D, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote")
