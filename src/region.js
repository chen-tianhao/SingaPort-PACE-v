import * as THREE from 'three';

/**
 * Regional reference map under the terminal.
 *
 * A flat, deliberately quiet layer that sits a few centimetres above the water
 * plane and carries the shape of Singapore's west coast at true geographic
 * scale, so the terminal reads in its real location. Everything here is drawn
 * in the same local ENU frame as the rest of the scene (+X east, +Z south).
 */

const MAP_Y = 1.2;           // just clear of the water plane, well under the 5 m deck
const LAND = 0x8b8880;       // warm neutral: separates from the blue sea by hue, not just value
const EDGE = 0xa5dcf2;
const GRID = 0x9ec4d8;
const DEG = 0.05;            // graticule step, ≈ 5.5 km — a quiet "this is a map" cue
const KX = 111320 * Math.cos((1.28 * Math.PI) / 180);
const KZ = 110574;

function ring2D(ring) {
  // drop the repeated closing vertex and any duplicated neighbours: the
  // triangulator closes the contour itself, and a zero-length edge makes it
  // emit degenerate ears
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
    out.push(p);
  }
  if (out.length > 3) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) out.pop();
  }
  return out;
}

function landGeometry(rings, y) {
  const pos = [];
  for (const raw of rings) {
    const ring = ring2D(raw);
    if (ring.length < 4) continue;
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const f of faces) {
      for (const i of f) pos.push(ring[i][0], y, ring[i][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function edgeGeometry(rings, y) {
  const pos = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      pos.push(ring[i][0], y, ring[i][1], ring[i + 1][0], y, ring[i + 1][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function graticuleGeometry(rings, y) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of rings) for (const [x, z] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const sx = DEG * KX, sz = DEG * KZ;
  const pos = [];
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) pos.push(x, y, z0, x, y, z1);
  for (let z = Math.ceil(z0 / sz) * sz; z <= z1; z += sz) pos.push(x0, y, z, x1, y, z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function label(text, screenH = 0.03) {
  const font = '600 64px "Inter","Segoe UI",sans-serif';
  const pad = 10;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = 64 + pad * 2;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.font = font;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineJoin = 'round';
  x.strokeStyle = 'rgba(236,244,250,0.45)';  // light halo: dark type stays legible on land and sea
  x.lineWidth = 6;
  x.strokeText(text, w / 2, h / 2 + 2);
  x.fillStyle = 'rgba(18,28,38,0.98)';
  x.fillText(text, w / 2, h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.9, fog: false,
    sizeAttenuation: false,   // constant on-screen size: a map label, not a world object
  }));
  s.scale.set((w / h) * screenH, screenH, 1);
  s.renderOrder = 4;
  return s;
}

export function buildRegionMap(region, group) {
  const g = new THREE.Group();
  g.name = 'regionMap';

  const land = new THREE.Mesh(
    landGeometry(region.rings, MAP_Y),
    new THREE.MeshBasicMaterial({
      color: LAND, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  land.renderOrder = 1;
  land.frustumCulled = false;
  g.add(land);

  const grid = new THREE.LineSegments(
    graticuleGeometry(region.rings, MAP_Y + 0.03),
    new THREE.LineBasicMaterial({ color: GRID, transparent: true, opacity: 0.13, depthWrite: false }),
  );
  grid.renderOrder = 2;
  grid.frustumCulled = false;
  g.add(grid);

  const edge = new THREE.LineSegments(
    edgeGeometry(region.rings, MAP_Y + 0.05),
    new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  edge.renderOrder = 3;
  edge.frustumCulled = false;
  g.add(edge);

  g.userData.labels = [];
  for (const l of region.labels || []) {
    const s = label(l.text);
    s.position.set(l.x, MAP_Y + 18, l.z);
    g.add(s);
    g.userData.labels.push({ sprite: s, x: l.x, z: l.z, screenH: 0.03 });
  }

  group.add(g);
  return g;
}

/**
 * Keep every label's quad clear of the sheet. A size-attenuated-off sprite has
 * a world height proportional to its distance, so the lift has to follow the
 * camera; otherwise the ground slices the lower half off the glyphs.
 */
export function updateRegionLabels(map, camera) {
  const list = map?.userData?.labels;
  if (!list) return;
  for (const l of list) {
    const dx = camera.position.x - l.x;
    const dz = camera.position.z - l.z;
    const d = Math.hypot(dx, dz, camera.position.y - MAP_Y);
    l.sprite.position.y = MAP_Y + 2 + l.screenH * d * 0.5 * 1.25;
  }
}
