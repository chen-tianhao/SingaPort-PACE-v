"""Re-layout PPT data: main roads, gate, yard subdivision, yard-crane flags.

Input : data/ppt_terminal.json (original, backed up once)
OSM   : .work/osm_term_roads.json (named terminal avenues/drives/gate)

Run:  python tools/relayout.py  (already applied 2026-11-06; do NOT re-run on the migrated data)
"""
import json
import math
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "ppt_terminal.json")
BACKUP = os.path.join(ROOT, "data", "ppt_terminal.orig.json")
OSM = os.path.join(ROOT, "tools", "osm_term_roads.json")
LON0, LAT0 = 103.76, 1.28
KX = 111320.0 * math.cos(math.radians(LAT0))

d = json.load(open(DATA, encoding="utf-8"))
if not os.path.exists(BACKUP):
    shutil.copyfile(DATA, BACKUP)

poly = [tuple(p) for p in d["land"]]


def inside(p):
    x, z = p
    c = False
    n = len(poly)
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xi = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < xi:
                c = not c
    return c


def to_xy(lon, lat):
    return ((lon - LON0) * KX, -(lat - LAT0) * 110574.0)


def simplify(pts, eps=2.0):
    if len(pts) < 3:
        return pts
    # Douglas-Peucker
    def rec(a, b, idx):
        if b <= a + 1:
            return []
        (x1, z1), (x2, z2) = pts[a], pts[b]
        dx, dz = x2 - x1, z2 - z1
        L = math.hypot(dx, dz) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            dist = abs(dz * (px - x1) - dx * (pz - z1)) / L
            if dist > best:
                best, bi = dist, i
        if best > eps:
            return rec(a, bi, idx) + [bi] + rec(bi, b, idx)
        return []
    keep = [0] + rec(0, len(pts) - 1, None) + [len(pts) - 1]
    return [pts[i] for i in keep]


# ---------------------------------------------------------------- main roads
WIDTHS = [
    ("Gate", 26),
    ("Avenue 8", 32),
    ("Avenue 1", 32),
    ("Avenue 2", 32),
    ("Avenue 3", 32),
    ("Link", 24),
    ("Drive", 20),
    ("Street", 16),
]
roads = []
for e in json.load(open(OSM, encoding="utf-8"))["elements"]:
    t = e.get("tags", {})
    name = t.get("name", "")
    if not name or "Building" in name or "Canteen" in name:
        continue
    if name == "Pasir Panjang Terminal":
        continue
    g = e.get("geometry", [])
    if len(g) < 2:
        continue
    pts = [to_xy(a["lon"], a["lat"]) for a in g]
    # keep the part of the way inside the terminal (midpoint test)
    runs, cur = [], []
    for a, b in zip(pts, pts[1:]):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if inside(mid):
            if not cur:
                cur = [a]
            cur.append(b)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    width = next((w for k, w in WIDTHS if k in name), 18)
    cls = "avenue" if "Avenue" in name else "drive" if "Drive" in name else \
          "gate" if "Gate" in name else "link" if "Link" in name else "street"
    for run in runs:
        sp = simplify(run, 2.5)
        if len(sp) >= 2 and sum(math.dist(a, b) for a, b in zip(sp, sp[1:])) > 25:
            roads.append({"name": name, "cls": cls, "width": width,
                          "pts": [[round(x, 1), round(z, 1)] for x, z in sp]})

# merge duplicates (same class/width and endpoints shared) is unnecessary for rendering
d["mainRoads"] = roads
print("mainRoads:", len(roads), "total km:",
      round(sum(math.dist(a, b) for r in roads for a, b in zip(r["pts"], r["pts"][1:])) / 1000, 1))

# ---------------------------------------------------------------- gate
# gate plaza centre from OSM Gate 4 loop, moved to the inner edge of the plaza
gx, gz = 1830.0, -390.0
d["gate"]["x"] = gx
d["gate"]["z"] = gz
d["gate"]["rot"] = -0.20
d["gate"]["osm_ref"] = "OSM way 325897215 (Pasir Panjang Terminal Gate 4)"
print("gate:", gx, gz, "lonlat", round(LON0 + gx / KX, 5), round(LAT0 - gz / 110574.0, 5))

# ---------------------------------------------------------------- yard blocks
new_yards = []
for y in d["yards"]:
    if y["tag"] == "B" and y["l"] >= 240:
        rad = math.radians(y["angle"])
        ax, az = math.sin(rad), math.cos(rad)       # local +Z in world
        half = (y["l"] - 6.0) / 2.0                  # 120 m each
        for k, side in ((-1, "a"), (1, "b")):
            off = k * (half / 2 + 3.0)
            nb = dict(y)
            nb["id"] = y["id"] + side
            nb["group"] = y["id"]
            nb["l"] = half
            nb["bays"] = 8
            nb["c"] = [round(y["c"][0] + ax * off, 2), round(y["c"][1] + az * off, 2)]
            nb["yc"] = 1 if side == "a" else 0
            nb["yc_t"] = 0.5 if side == "a" else 0.0
            new_yards.append(nb)
    else:
        nb = dict(y)
        nb["group"] = y["id"]
        nb["yc_t"] = -0.5
        nb["yc"] = 1
        new_yards.append(nb)

# D zone: one crane per two blocks (alternate along the arm)
d_blocks = [y for y in new_yards if y["tag"] == "D"]
d_blocks.sort(key=lambda y: (y["c"][1], y["c"][0]))
for i, y in enumerate(d_blocks):
    y["yc"] = 1 if i % 2 == 0 else 0

# clear the gate plaza: no container blocks within 140 m of the gate complex
gate_c = (gx, gz - 40.0)
before = len(new_yards)
new_yards = [y for y in new_yards
             if math.hypot(y["c"][0] - gate_c[0], y["c"][1] - gate_c[1]) > 140]
print("gate plaza: removed", before - len(new_yards), "blocks")

d["yards"] = new_yards
d["meta"]["yards"] = len(new_yards)
yc_total = sum(y["yc"] for y in new_yards)
rtg = sum(y["yc"] for y in new_yards if y["crane"] == "RTG")
rmg = sum(y["yc"] for y in new_yards if y["crane"] == "RMG")
d["equipment"]["yard_cranes"] = {
    "total": yc_total, "rtg": rtg, "rmg": rmg, "ohbc": 0,
    "source": "satellite count 2026-11-06: 1/RTG block, 1/2 RMG blocks",
}
print("yards:", len(new_yards), "cranes:", yc_total, "rtg", rtg, "rmg", rmg)

# ---------------------------------------------------------------- meta
d["meta"]["generated"] = "2026-11-06"
d["meta"]["layout_revision"] = "2026-11-06b (main roads / gate / yard split / cranes)"

json.dump(d, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", DATA, os.path.getsize(DATA))



