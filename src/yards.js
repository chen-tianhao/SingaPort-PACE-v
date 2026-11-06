import * as THREE from 'three';
import { mat, instanced, setInst, rng, merge } from './geo.js';

const COLORS = [0xb3402f, 0x2a5c8a, 0x2e6b4f, 0xc07a2a, 0x9aa0a6, 0xd8dcdd, 0x7a4b8f, 0x1f6f8b];
const DECK = 5.0;
const CELL = 500;                 // spatial chunk edge (m)
const NEAR_GEO = new THREE.BoxGeometry(12.19, 2.59, 2.44);

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** One yard block, reduced to the data needed to build its three LOD tiers. */
function planBlock(y) {
  const rand = rng(hashOf(y.id));
  const ang = (-y.angle * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const near = [];              // [localX, worldY, localZ, color]
  for (let r = 0; r < y.rows; r++) {
    for (let b = 0; b < y.bays; b++) {
      const stackTiers = 1 + Math.floor(rand() * y.tiers);
      for (let t = 0; t < stackTiers; t++) {
        if (rand() > y.fill + 0.26) continue;
        const px = -y.l / 2 + 8 + b * y.bay_pitch;
        const pz = -y.w / 2 + 5 + r * y.row_pitch;
        const base = COLORS[(Math.floor(b / 5) + y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length];
        const c = rand() > 0.90 ? COLORS[(b + 3) % COLORS.length] : base;
        near.push([px, DECK + 1.55 + t * y.tier_h, pz, c]);
      }
    }
  }
  const mid = [];               // [localX, worldY, color]
  for (let b = 0; b < y.bays; b++) {
    const px = -y.l / 2 + 8 + b * y.bay_pitch;
    mid.push([px, DECK + 0.25 + (y.tiers * y.tier_h * 0.86) / 2,
      COLORS[(Math.floor(b / 5) + y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length]]);
  }
  const far = { h: y.tiers * y.tier_h * 0.8, color:
    COLORS[(y.id.charCodeAt(1) + y.id.charCodeAt(2)) % COLORS.length] };
  return { y, ang, ca, sa, near, mid, far };
}

/**
 * A spatial chunk of yard blocks.
 *
 * All blocks in a chunk share three merged representations, so a chunk costs
 * one draw call instead of one per block:
 *   near - every container as an instance
 *   mid  - one slab per bay as an instance
 *   far  - one volume per block, merged into a single mesh with vertex colours
 */
class YardChunk {
  constructor(plans) {
    this.plans = plans;
    this.group = new THREE.Group();
    let sx = 0, sz = 0;
    for (const p of plans) { sx += p.y.c[0]; sz += p.y.c[1]; }
    this.cx = sx / plans.length;
    this.cz = sz / plans.length;
    this.group.position.set(this.cx, 0, this.cz);

    // world -> chunk local (Three.js rotation about Y: x'=x cos+z sin, z'=-x sin+z cos)
    const local = (p, px, pz) => {
      const wx = p.y.c[0] + px * p.ca + pz * p.sa - this.cx;
      const wz = p.y.c[1] - px * p.sa + pz * p.ca - this.cz;
      return [wx, wz];
    };

    // ---------------- near: all containers of the chunk
    const nItems = [];
    for (const p of plans) for (const it of p.near) {
      const [wx, wz] = local(p, it[0], it[2]);
      nItems.push([wx, it[1], wz, it[3]]);
    }
    const near = instanced(NEAR_GEO, mat(0xffffff, { roughness: 0.78 }), Math.max(nItems.length, 1));
    const col = new THREE.Color();
    nItems.forEach((it, i) => {
      setInst(near, i, it[0], it[1], it[2]);
      col.setHex(it[3]);
      near.setColorAt(i, col);
    });
    near.count = nItems.length;
    if (near.instanceColor) near.instanceColor.needsUpdate = true;
    near.computeBoundingSphere();
    this.near = near;

    // ---------------- mid: one slab per bay (grouped by slab geometry)
    const midGroups = new Map();
    for (const p of plans) {
      const key = `${p.y.bay_pitch}|${p.y.tiers}|${p.y.tier_h}|${p.y.rows}|${p.y.row_pitch}`;
      if (!midGroups.has(key)) midGroups.set(key, []);
      const arr = midGroups.get(key);
      for (const it of p.mid) {
        const [wx, wz] = local(p, it[0], 0);
        arr.push([wx, it[1], wz, it[2]]);
      }
    }
    this.mids = [];
    for (const [key, items] of midGroups) {
      const [bp, tiers, th, rows, rp] = key.split('|').map(Number);
      const g = new THREE.BoxGeometry(bp * 0.98, tiers * th * 0.86, rows * rp * 0.94);
      const m = instanced(g, mat(0xffffff, { roughness: 0.9 }), Math.max(items.length, 1));
      const mc = new THREE.Color();
      items.forEach((it, i) => {
        setInst(m, i, it[0], it[1], it[2]);
        mc.setHex(it[3]).lerp(new THREE.Color(0x6b7178), 0.28);
        m.setColorAt(i, mc);
      });
      m.count = items.length;
      m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.mids.push(m);
    }

    // ---------------- far: one merged mesh of block volumes
    const geos = [];
    for (const p of plans) {
      const g = new THREE.BoxGeometry(p.y.l * 0.97, p.far.h, p.y.w * 0.94);
      g.rotateY(p.ang);
      const [wx, wz] = local(p, 0, 0);
      g.translate(wx, DECK + 0.25 + p.far.h / 2, wz);
      const fc = new THREE.Color(p.far.color).lerp(new THREE.Color(0x6b7178), 0.42);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = fc.r; arr[i * 3 + 1] = fc.g; arr[i * 3 + 2] = fc.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    }
    this.far = new THREE.Mesh(merge(geos), mat(0xffffff, { roughness: 1, vertexColors: true }));

    this.group.add(this.near, ...this.mids, this.far);
    this.level = -1;
  }

  setLevel(l) {
    if (l === this.level) return;
    this.level = l;
    this.near.visible = l === 0;
    for (const m of this.mids) m.visible = l === 1;
    this.far.visible = l === 2;
  }
}

export function buildYards(data, group, opts = {}) {
  // ---- plan every block, then bucket them into spatial chunks
  const plans = data.yards.map(planBlock);
  const cells = new Map();
  plans.forEach((p, i) => {
    const key = `${Math.floor(p.y.c[0] / CELL)},${Math.floor(p.y.c[1] / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
    p.index = i;
  });

  const blocks = [];
  const chunks = [];
  let total = 0;
  for (const [key, list] of cells) {
    const chunk = new YardChunk(list);
    chunks.push(chunk);
    group.add(chunk.group);
    for (const p of list) {
      blocks.push({ id: p.y.id, cx: p.y.c[0], cz: p.y.c[1], level: 2, count: p.near.length });
      total += p.near.length;
    }
  }

  const nearDist = opts.nearDist ?? 900;
  const midDist = opts.midDist ?? 7000;

  function update(camPos) {
    for (const b of blocks) {
      const d = Math.hypot(camPos.x - b.cx, camPos.z - b.cz);
      b.level = d < nearDist ? 0 : d < midDist ? 1 : 2;
    }
    // a chunk shows one tier for all of its blocks: the most detailed tier
    // present in the chunk wins, so nothing near the camera is downgraded
    for (const c of chunks) {
      let lvl = 2;
      for (const p of c.plans) {
        const b = blocks[p.index];
        if (b.level < lvl) lvl = b.level;
      }
      c.setLevel(lvl);
    }
  }
  update(new THREE.Vector3(3000, 800, 4000));

  return { blocks, chunks, total, update, group };
}
