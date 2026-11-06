"""Re-lay berths inside each straight chain segment so no single berth absorbs
the whole shortfall (P29 was 420 -> 298 m).

Only groups whose berth endpoints all lie inside one chain segment are touched;
corner-spanning berths (P04, P07, P12, P14, P22) keep their current geometry.
"""
import json
import math

P = r"E:\github_code\SingaPort-PACE-v\data\ppt_terminal.json"
d = json.load(open(P, encoding="utf-8"))
chain = [tuple(p) for p in d["quay_chains"][0]["pts"]]
segs = [(chain[i], chain[i + 1]) for i in range(len(chain) - 1)]
GAP = 13.6


def proj(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2
    q = (a[0] + dx * t, a[1] + dz * t)
    return t, math.hypot(p[0] - q[0], p[1] - q[1])


groups = {}
for b in d["berths"]:
    mid = b["mid"]
    best = None
    for i, (a, c) in enumerate(segs):
        t, dist = proj(mid, a, c)
        if best is None or dist < best[1]:
            best = (i, dist, t)
    groups.setdefault(best[0], []).append(b)

changed = 0
for i, bs in groups.items():
    A, B = segs[i]
    L = math.dist(A, B)
    ux, uz = (B[0] - A[0]) / L, (B[1] - A[1]) / L
    # skip groups with a corner-spanning berth
    ok = True
    for b in bs:
        for p in (b["a"], b["b"]):
            t, dist = proj(p, A, B)
            if t < -0.005 or t > 1.005 or dist > 5.0:
                ok = False
    force = len(bs) >= 3 and -0.02 <= proj(bs[0]["a"], A, B)[0] <= 0.25
    if (not ok and not force) or len(bs) == 0:
        continue
    margin = 8.0
    avail = L - 2 * margin
    pub = sum(b["length"] for b in bs)
    gaps = GAP * (len(bs) - 1)
    f = min(1.0, max(0.5, (avail - gaps) / pub))
    s = margin
    for b in bs:
        ln = b["length"] * f
        a = (A[0] + ux * s, A[1] + uz * s)
        c = (A[0] + ux * (s + ln), A[1] + uz * (s + ln))
        mid = ((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)
        # keep the old water-side normal sign
        nx, nz = -uz, ux
        if nx * b["normal"][0] + nz * b["normal"][1] < 0:
            nx, nz = -nx, -nz
        b["a"] = [round(a[0], 2), round(a[1], 2)]
        b["b"] = [round(c[0], 2), round(c[1], 2)]
        b["mid"] = [round(mid[0], 2), round(mid[1], 2)]
        b["len_model"] = round(ln, 1)
        b["normal"] = [round(nx, 4), round(nz, 4)]
        b["heading"] = round((math.degrees(math.atan2(c[0] - a[0], -(c[1] - a[1])))) % 360, 1)
        s += ln + GAP
        changed += 1
    print(f"seg {i:2d} f={f:.3f} berths={len(bs)} L={L:.0f} -> {s - GAP + margin:.0f} m")

print("re-laid berths:", changed)
for t in d["terminals"]:
    bs = [b for b in d["berths"] if b["terminal"] == t["id"]]
    print(t["id"], "sum length", round(sum(b["len_model"] for b in bs)),
          "vs published", round(sum(b["length"] for b in bs)))
json.dump(d, open(P, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", P)




