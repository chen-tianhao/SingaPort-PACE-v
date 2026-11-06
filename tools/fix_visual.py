"""Fix the five visual issues (applied 2026-11-06c; do NOT re-run on migrated data).

1. offset the 15 quay apron roads 13 m inland (they were centred on the waterline)
2. drop yard blocks whose near edge is < 34 m from the quay (STS crane legs)
3. drop blocks in the PPAT car-terminal area (520 x 460 m at the west tip)
4. drop blocks intersecting the two gate buildings (admin / PPEIS)
"""
import json
import math

P = r"E:\github_code\SingaPort-PACE-v\data\ppt_terminal.json"
D = json.load(open(P, encoding="utf-8"))
LAND = [tuple(p) for p in D["land"]]
CHAIN = [tuple(p) for p in D["quay_chains"][0]["pts"]]


def inside(p):
    x, z = p
    c = False
    n = len(LAND)
    for i in range(n):
        x1, z1 = LAND[i]
        x2, z2 = LAND[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xi = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < xi:
                c = not c
    return c


def seg_dist(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    q = (a[0] + dx * t, a[1] + dz * t)
    return math.hypot(p[0] - q[0], p[1] - q[1])


def chain_dist(p):
    return min(seg_dist(p, a, b) for a, b in zip(CHAIN, CHAIN[1:]))


def rect_pts(cx, cz, w, l, ang):
    rad = math.radians(ang)
    ca, sa = math.cos(rad), math.sin(rad)
    return [(cx + a * ca + b * sa, cz - a * sa + b * ca)
            for a, b in ((-w / 2, -l / 2), (w / 2, -l / 2), (w / 2, l / 2), (-w / 2, l / 2))]


def axes(cx, cz, w, l, ang):
    rad = math.radians(ang)
    ca, sa = math.cos(rad), math.sin(rad)
    return ((ca, -sa), (sa, ca)), (cx, cz), (w / 2, l / 2)


def overlap_rect(r1, r2):
    a1, c1, h1 = axes(*r1)
    a2, c2, h2 = axes(*r2)
    for ax in (a1[0], a1[1], a2[0], a2[1]):
        d = abs((c2[0] - c1[0]) * ax[0] + (c2[1] - c1[1]) * ax[1])
        e = (h1[0] * abs(a1[0][0] * ax[0] + a1[0][1] * ax[1]) +
             h1[1] * abs(a1[1][0] * ax[0] + a1[1][1] * ax[1]) +
             h2[0] * abs(a2[0][0] * ax[0] + a2[0][1] * ax[1]) +
             h2[1] * abs(a2[1][0] * ax[0] + a2[1][1] * ax[1]))
        if d > e:
            return False
    return True


# ---------------------------------------------------------------- 1 roads
print("== roads ==")
for r in D["roads"]:
    ax, az = r["a"]
    bx, bz = r["b"]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1
    nx, nz = -dz / L, dx / L
    off = r["width"] / 2 + 2.0
    mid = ((ax + bx) / 2, (az + bz) / 2)
    cand = [(mid[0] + nx * off, mid[1] + nz * off), (mid[0] - nx * off, mid[1] - nz * off)]
    best = None
    for sgn, p in ((1, cand[0]), (-1, cand[1])):
        if inside(p):
            best = sgn
            break
    if best is None:
        best = 1
    r["a"] = [round(ax + nx * off * best, 1), round(az + nz * off * best, 1)]
    r["b"] = [round(bx + nx * off * best, 1), round(bz + nz * off * best, 1)]
    print(f'  {r["id"]}: offset {off:.0f} m side {best}')

# ---------------------------------------------------------------- 2/3/4 blocks
print("\n== blocks ==")
G = D["gate"]
halfW = (G["in_lanes"] + G["out_lanes"]) * G["lane_w"] / 2
grot = G.get("rot", -0.2)
gx, gz = G["x"], G["z"] - 40
rad = math.radians(grot)
buildings = []
for lx, lz, w, l, name in ((halfW + 90, 60, 110, 60, "admin"),
                           (-halfW - 90, 55, 70, 40, "ppeis")):
    wx = gx + lx * math.cos(rad) + lz * math.sin(rad)
    wz = gz - lx * math.sin(rad) + lz * math.cos(rad)
    buildings.append(((wx, wz, w + 24, l + 24, grot), name))

PPAT = (-820, -270, 520, 460, 59.3)
keep = []
drop_near = drop_ppat = drop_gate = 0
for y in D["yards"]:
    pts = rect_pts(y["c"][0], y["c"][1], y["w"], y["l"], y["angle"])
    near = min(chain_dist(p) for p in pts)
    in_ppat = overlap_rect((y["c"][0], y["c"][1], y["w"], y["l"], y["angle"]), PPAT)
    in_gate = any(overlap_rect((y["c"][0], y["c"][1], y["w"], y["l"], y["angle"]), b[0])
                  for b in buildings)
    reason = None
    if near < 36:
        reason = "near"
        drop_near += 1
    elif in_ppat:
        reason = "ppat"
        drop_ppat += 1
    elif in_gate:
        reason = "gate"
        drop_gate += 1
    if reason is None:
        keep.append(y)

D["yards"] = keep
D["meta"]["yards"] = len(keep)
yc = sum(y["yc"] for y in keep)
D["equipment"]["yard_cranes"]["total"] = yc
D["equipment"]["yard_cranes"]["rtg"] = sum(y["yc"] for y in keep if y["crane"] == "RTG")
D["equipment"]["yard_cranes"]["rmg"] = sum(y["yc"] for y in keep if y["crane"] == "RMG")
D["equipment"]["yard_cranes"]["source"] = "satellite count 2026-11-06; blocks filtered for apron/PPAT/gate"
print(f"  dropped near-quay {drop_near}, PPAT {drop_ppat}, gate {drop_gate}")
print(f"  kept {len(keep)} blocks, yard cranes {yc} "
      f"(rtg {D['equipment']['yard_cranes']['rtg']}, rmg {D['equipment']['yard_cranes']['rmg']})")


# ---------------------------------------------------------------- 3b lanes
def rect_dist(p, cx, cz, w, l, ang):
    rad = math.radians(ang)
    ca, sa = math.cos(rad), math.sin(rad)
    dx, dz = p[0] - cx, p[1] - cz
    lx = dx * ca - dz * sa
    lz = dx * sa + dz * ca
    ox = max(abs(lx) - w / 2, 0)
    oz = max(abs(lz) - l / 2, 0)
    return math.hypot(ox, oz)


lanes = []
for ln in D.get("yardLanes", []):
    ax, az = ln["a"]
    bx, bz = ln["b"]
    best = 1e9
    for k in range(7):
        t = k / 6
        p = (ax + (bx - ax) * t, az + (bz - az) * t)
        d = min(rect_dist(p, y["c"][0], y["c"][1], y["w"], y["l"], y["angle"]) for y in keep)
        best = min(best, d)
    if best <= 22:
        lanes.append(ln)
print(f"  yard lanes kept {len(lanes)} of {len(D.get('yardLanes', []))} (orphans pruned)")
D["yardLanes"] = lanes

json.dump(D, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", P)


