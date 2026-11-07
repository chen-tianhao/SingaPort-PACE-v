"""Warp the z18 Google mosaic into the model frame for the satellite base layer."""
import json
import math
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
META = json.load(open(os.path.join(HERE, "g18.jpg.json")))
IM = Image.open(os.path.join(HERE, "g18.jpg")).convert("RGB")
A = np.asarray(IM, dtype=np.float32)

LON0, LAT0 = 103.76, 1.28
KX = 111320.0 * math.cos(math.radians(LAT0))
# model-frame bbox of the texture
X0, X1 = -1800.0, 4500.0
Z0, Z1 = -1800.0, 3150.0
W = 4096
H = int(round(W * (Z1 - Z0) / (X1 - X0)))
print("output", W, H)

SCALE = 256 * 2 ** META["z"]
OX = META["tile_x0"] * 256 + META["px0"]
OY = META["tile_y0"] * 256 + META["py0"]

out = np.zeros((H, W, 3), dtype=np.uint8)
xs = X0 + (np.arange(W) + 0.5) / W * (X1 - X0)
lons = LON0 + xs / KX
for y0 in range(0, H, 128):
    y1 = min(H, y0 + 128)
    zs = Z0 + (np.arange(y0, y1) + 0.5) / H * (Z1 - Z0)
    lats = LAT0 - zs / 110574.0
    lon = lons[None, :]
    lat = lats[:, None]
    px = (lon + 180.0) / 360.0 * SCALE - OX
    r = np.radians(lat)
    py = (1.0 - np.log(np.tan(r) + 1.0 / np.cos(r)) / np.pi) / 2.0 * SCALE - OY
    px = np.broadcast_to(px, (y1 - y0, W))
    py = np.broadcast_to(py, (y1 - y0, W))
    x0 = np.floor(px).astype(np.int32)
    y0i = np.floor(py).astype(np.int32)
    fx = (px - x0)[..., None]
    fy = (py - y0i)[..., None]
    x0 = np.clip(x0, 0, A.shape[1] - 2)
    y0i = np.clip(y0i, 0, A.shape[0] - 2)
    p00 = A[y0i, x0]
    p10 = A[y0i, x0 + 1]
    p01 = A[y0i + 1, x0]
    p11 = A[y0i + 1, x0 + 1]
    out[y0:y1] = (p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
                  p01 * (1 - fx) * fy + p11 * fx * fy).astype(np.uint8)
    print("row", y1, flush=True)

img = Image.fromarray(out)
img.save(os.path.join(ROOT, "data", "ppt_satellite.jpg"), quality=86)
json.dump({"x0": X0, "x1": X1, "z0": Z0, "z1": Z1, "width": W, "height": H},
          open(os.path.join(ROOT, "data", "ppt_satellite.json"), "w"))
print("wrote", img.size, os.path.getsize(os.path.join(ROOT, "data", "ppt_satellite.jpg")))
