import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PAL = {
  water:      0x2f6b88,
  waterDeep:  0x1b4a63,
  land:       0x565d63,
  asphalt:    0x4e545a,
  concrete:   0xc3c9cd,
  concreteDk: 0x7c8286,
  yard:       0x6d7377,
  rail:       0x5a6167,
  crane:      0xdfe4e8,
  craneBlue:  0x1f4f7a,
  craneRed:   0xa8402f,
  shipHull:   0x22394a,
  shipDeck:   0x6b7378,
  shipHouse:  0xd9dde0,
  rmg:        0xc9ced2,
  rmgBlue:    0x2b6187,
  truck:      0x2c3238,
  buoyRed:    0xb03a2e,
  buoyGreen:  0x2e7d52,
  channel:    0x2b6b8f,
  channelHot: 0x49a7cf,
  gate:       0xa9b0b4,
};

const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.82, metalness: opts.metalness ?? 0.06,
    flatShading: !!opts.flat, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide, depthWrite: opts.depthWrite ?? true,
    vertexColors: !!opts.vertexColors,
  });
  cache.set(key, m);
  return m;
}

/** Axis aligned box geometry, optionally rotated about Y then translated. */
export function box(w, h, d, x = 0, y = 0, z = 0, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** Cylinder along Y. */
export function cyl(r, h, x = 0, y = 0, z = 0, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y, z);
  return g;
}

export function merge(list) {
  const clean = list.filter(Boolean);
  if (!clean.length) return null;
  return mergeGeometries(clean, false);
}

/** Flat quad in XZ plane from a to b with the given width. */
export function ribbon(ax, az, bx, bz, width, y = 0) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const g = new THREE.PlaneGeometry(len, width, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.atan2(-dz, dx));
  g.translate((ax + bx) / 2, y, (az + bz) / 2);
  return g;
}

/** Deterministic PRNG so both engine builds look alike. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function instanced(geo, material, count) {
  const m = new THREE.InstancedMesh(geo, material, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  return m;
}

export function setInst(mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  mesh.setMatrixAt(i, m);
}
