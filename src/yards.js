import * as THREE from 'three';
import { mat, instanced, setInst, rng } from './geo.js';

const COLORS = [0xb3402f, 0x2a5c8a, 0x2e6b4f, 0xc07a2a, 0x9aa0a6, 0xd8dcdd, 0x7a4b8f, 0x1f6f8b];
const DECK = 5.0;

/** Three-level LOD container block, built in local coordinates then rotated. */
class YardBlock {
  constructor(y) {
    this.y = y;
    this.group = new THREE.Group();
    this.cx = y.c[0];
    this.cz = y.c[1];
    this.group.position.set(this.cx, 0, this.cz);
    this.group.rotation.y = (-y.angle * Math.PI) / 180;

    const w = y.w, l = y.l;
    const rand = rng(this.hash(y.id));

    // ---------------- near: individual containers (bays along local X)
    const geo = new THREE.BoxGeometry(12.19, 2.59, 2.44);
    const items = [];
    for (let r = 0; r < y.rows; r++) {
      for (let b = 0; b < y.bays; b++) {
        const stackTiers = 1 + Math.floor(rand() * y.tiers);
        for (let t = 0; t < stackTiers; t++) {
          if (rand() > y.fill + 0.26) continue;
          const px = -l / 2 + 8 + b * y.bay_pitch;
          const pz = -w / 2 + 5 + r * y.row_pitch;
          const base = COLORS[(Math.floor(b / 5) + y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length];
          const c = rand() > 0.90 ? COLORS[(b + 3) % COLORS.length] : base;
          items.push([px, DECK + 1.55 + t * y.tier_h, pz, c]);
        }
      }
    }
    const near = instanced(geo, mat(0xffffff, { roughness: 0.78 }), Math.max(items.length, 1));
    const col = new THREE.Color();
    items.forEach((it, i) => {
      setInst(near, i, it[0], it[1], it[2]);
      col.setHex(it[3]);
      near.setColorAt(i, col);
    });
    near.count = items.length;
    if (near.instanceColor) near.instanceColor.needsUpdate = true;
    near.computeBoundingSphere();
    this.near = near;
    this.count = items.length;

    // ---------------- mid: one slab per bay
    const geoMid = new THREE.BoxGeometry(y.bay_pitch * 0.98, y.tiers * y.tier_h * 0.86, y.rows * y.row_pitch * 0.94);
    const mid = instanced(geoMid, mat(0xffffff, { roughness: 0.9 }), y.bays);
    const mc = new THREE.Color();
    for (let b = 0; b < y.bays; b++) {
      const px = -l / 2 + 8 + b * y.bay_pitch;
      setInst(mid, b, px, DECK + 0.25 + (y.tiers * y.tier_h * 0.86) / 2, 0);
      mc.setHex(COLORS[(Math.floor(b / 5) + y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length]);
      mc.lerp(new THREE.Color(0x6b7178), 0.28);
      mid.setColorAt(b, mc);
    }
    mid.instanceColor.needsUpdate = true;
    mid.computeBoundingSphere();
    this.mid = mid;

    // ---------------- far: single volume
    const farGeo = new THREE.BoxGeometry(l * 0.97, y.tiers * y.tier_h * 0.8, w * 0.94);
    const fc = new THREE.Color(COLORS[(y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length]);
    fc.lerp(new THREE.Color(0x6b7178), 0.42);
    this.far = new THREE.Mesh(farGeo, mat(fc.getHex(), { roughness: 1 }));
    this.far.position.set(0, DECK + 0.25 + (y.tiers * y.tier_h * 0.8) / 2, 0);

    this.group.add(near, mid, this.far);
    this.level = -1;
  }

  hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  setLevel(l) {
    if (l === this.level) return;
    this.level = l;
    this.near.visible = l === 0;
    this.mid.visible = l === 1;
    this.far.visible = l === 2;
  }
}

export function buildYards(data, group, opts = {}) {
  const blocks = [];
  let total = 0;
  for (const y of data.yards) {
    const b = new YardBlock(y);
    blocks.push(b);
    group.add(b.group);
    total += b.count;
  }
  const nearDist = opts.nearDist ?? 900;
  const midDist = opts.midDist ?? 7000;

  function update(camPos) {
    for (const b of blocks) {
      const d = Math.hypot(camPos.x - b.cx, camPos.z - b.cz);
      b.setLevel(d < nearDist ? 0 : d < midDist ? 1 : 2);
    }
  }
  update(new THREE.Vector3(3000, 800, 4000));

  return { blocks, total, update, group };
}
