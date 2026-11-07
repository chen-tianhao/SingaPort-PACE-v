"""Regenerate from prev2: normals, roads, sheds at the real PPT2 buildings,
lane widths, block clearance."""
import json
import math
import os
import shutil

R = r"E:\github_code\SingaPort-PACE-v"
PREV = os.path.join(R, "data", "ppt_terminal.prev2.json")
P = os.path.join(R, "data", "ppt_terminal.json")
shutil.copyfile(PREV, P)
D = json.load(open(P, encoding="utf-8"))
CHAIN = [tuple(p) for p in D["quay_chains"][0]["pts"]]
LAND = [tuple(p) for p in D["land"]]


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


def seg_proj(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    q = (a[0] + dx * t, a[1] + dz * t)
    return t, math.hypot(p[0] - q[0], p[1] - q[1]), q


# ---- normals
for b in D["berths"]:
    dx = b["b"][0] - b["a"][0]
    dz = b["b"][1] - b["a"][1]
    L = math.hypot(dx, dz) or 1
    n1 = (-dz / L, dx / L)
    n2 = (dz / L, -dx / L)
    mid = b["mid"]
    i1 = inside((mid[0] + n1[0] * 50, mid[1] + n1[1] * 50))
    i2 = inside((mid[0] + n2[0] * 50, mid[1] + n2[1] * 50))
    if i1 and not i2:
        water = n2
    elif i2 and not i1:
        water = n1
    else:
        water = n1 if (n1[0] * b["normal"][0] + n1[1] * b["normal"][1]) >= \
                       (n2[0] * b["normal"][0] + n2[1] * b["normal"][1]) else n2
    b["normal"] = [round(water[0], 4), round(water[1], 4)]
    b["heading"] = round((math.degrees(math.atan2(dx, -dz)) % 360), 1)
print("normals fixed")

# ---- roads
seg_n = []
for i, (a, b) in enumerate(zip(CHAIN, CHAIN[1:])):
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    best = min(D["berths"], key=lambda x: math.dist(x["mid"], mid))
    seg_n.append(tuple(best["normal"]))
OFF = 26.0
inland = []
for i, p in enumerate(CHAIN):
    ns = []
    if i > 0:
        ns.append(seg_n[i - 1])
    if i < len(seg_n):
        ns.append(seg_n[i])
    nx = sum(n[0] for n in ns) / len(ns)
    nz = sum(n[1] for n in ns) / len(ns)
    L = math.hypot(nx, nz) or 1
    nx, nz = nx / L, nz / L
    cosang = max(0.35, abs(nx * ns[0][0] + nz * ns[0][1]))
    sc = 1 / cosang
    inland.append((p[0] - nx * OFF * sc, p[1] - nz * OFF * sc))
D["roads"] = [{"id": f"R{i+1}",
               "a": [round(inland[i][0], 1), round(inland[i][1], 1)],
               "b": [round(inland[i + 1][0], 1), round(inland[i + 1][1], 1)],
               "width": 14, "type": "quay"} for i in range(len(CHAIN) - 1)]
print("roads rebuilt")

# ---- lanes
for ln in D["yardLanes"]:
    ln["width"] = 13.0

# ---- sheds: the large U-shaped PPT2 warehouse complex + a long shed east of it
sheds = [
    {"c": [-425, -325], "w": 250, "l": 50, "h": 13.0, "angle": 0.0},
    {"c": [-325, -250], "w": 50, "l": 200, "h": 12.6, "angle": 0.0},
    {"c": [-425, -175], "w": 250, "l": 50, "h": 12.8, "angle": 0.0},
]
D["sheds"] = sheds
print("sheds", sheds)


def rect_pts(cx, cz, w, l, ang):
    rad = math.radians(ang)
    ca, sa = math.cos(rad), math.sin(rad)
    return [(cx + a * ca + b * sa, cz - a * sa + b * ca)
            for a, b in ((-w / 2, -l / 2), (w / 2, -l / 2), (w / 2, l / 2), (-w / 2, l / 2))]


def overlap(r1, r2):
    def axes(cx, cz, w, l, ang):
        rad = math.radians(ang)
        ca, sa = math.cos(rad), math.sin(rad)
        return ((ca, -sa), (sa, ca)), (cx, cz), (w / 2, l / 2)
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


def chain_dist_rect(y):
    pts = rect_pts(y["c"][0], y["c"][1], y["w"], y["l"], y["angle"])
    best = 1e9
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = math.dist(a, b)
        n = max(2, int(L / 3))
        for k in range(n + 1):
            p = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
            best = min(best, min(seg_proj(p, c, d)[1] for c, d in zip(CHAIN, CHAIN[1:])))
    return best


keep = []
dn = ds = 0
for y in D["yards"]:
    if chain_dist_rect(y) < 38:
        dn += 1
        continue
    if any(overlap((y["c"][0], y["c"][1], y["w"], y["l"], y["angle"]),
                   (s["c"][0], s["c"][1], s["w"], s["l"], s["angle"])) for s in sheds):
        ds += 1
        continue
    keep.append(y)
D["yards"] = keep
D["meta"]["yards"] = len(keep)
D["equipment"]["yard_cranes"]["total"] = sum(y["yc"] for y in keep)
D["equipment"]["yard_cranes"]["rtg"] = sum(y["yc"] for y in keep if y["crane"] == "RTG")
D["equipment"]["yard_cranes"]["rmg"] = sum(y["yc"] for y in keep if y["crane"] == "RMG")
print("dropped near", dn, "shed", ds, "kept", len(keep), "cranes", D["equipment"]["yard_cranes"]["total"])

json.dump(D, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote")


