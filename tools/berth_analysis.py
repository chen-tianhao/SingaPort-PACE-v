"""Analyse berth-to-chain-segment mapping and feasible uniform compression."""
import json
import math

P = r"E:\github_code\SingaPort-PACE-v\data\ppt_terminal.json"
d = json.load(open(P, encoding="utf-8"))
chain = [tuple(p) for p in d["quay_chains"][0]["pts"]]
segs = [(chain[i], chain[i + 1]) for i in range(len(chain) - 1)]


def seg_proj(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    q = (a[0] + dx * t, a[1] + dz * t)
    return t, math.hypot(p[0] - q[0], p[1] - q[1]), q


print("berth  seg  t   dist   len  comp")
groups = {}
for b in d["berths"]:
    mid = b["mid"]
    best = None
    for i, (a, c) in enumerate(segs):
        t, dist, q = seg_proj(mid, a, c)
        if best is None or dist < best[1]:
            best = (i, dist, t)
    i, dist, t = best
    groups.setdefault(i, []).append(b)
    print(f'{b["id"]} {i:2d} {t:.2f} {dist:5.1f} {b["length"]:4d} {b["len_model"]:4d}')

print("\nsegment groups:")
for i, bs in groups.items():
    L = math.dist(segs[i][0], segs[i][1])
    req = sum(b["length"] for b in bs) + 13.6 * (len(bs) - 1)
    print(f"seg {i:2d} len {L:7.1f} berths {len(bs):2d} {bs[0]['id']}..{bs[-1]['id']} "
          f"required {req:7.1f} ratio {L/req:.3f}")
print("global min ratio (uniform f):",
      min(math.dist(segs[i][0], segs[i][1]) /
          (sum(b["length"] for b in bs) + 13.6 * (len(bs) - 1))
          for i, bs in groups.items()))

