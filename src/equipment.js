import * as THREE from 'three';
import { PAL, mat, box, merge, instanced, setInst, rng } from './geo.js';

/* ------------------------------------------------------------------ quay cranes */
function qcGeometry(outreach = 54, height = 48, gauge = 30.48) {
  const parts = [];
  const gx = 9.5;                     // portal frame spacing along the quay
  const half = gauge / 2;

  for (const x of [-gx, gx]) {
    for (const z of [-half, half]) {
      parts.push(box(3.2, height, 3.2, x, height / 2, z));            // legs
      parts.push(box(4.2, 1.2, 4.2, x, 0.6, z));                      // bogies
    }
    parts.push(box(2.6, 3.0, gauge + 3.4, x, 7.5, 0));                // sill beam
    parts.push(box(2.8, 3.4, gauge + 2.4, x, height - 1.7, 0));       // portal top beam
    // diagonal bracing in the portal frame
    for (const sgn of [-1, 1]) {
      const len = Math.hypot(height - 9, gauge * 0.55);
      const b = new THREE.BoxGeometry(1.1, len, 1.1);
      b.rotateX(sgn * Math.atan2(gauge * 0.55, height - 9));
      b.translate(x, (height + 9) / 2, sgn * gauge * 0.27);
      parts.push(b);
    }
  }

  // ---- boom: two chords + vertical posts, over the water
  const boomLen = 76, boomY = height + 2;
  for (const dz of [-3.2, 3.2]) parts.push(box(1.2, 1.2, boomLen, 0, boomY + 1.6, 16));
  for (const dx of [-5.5, 5.5]) parts.push(box(1.2, 1.2, boomLen, dx, boomY - 1.6, 16));
  for (let i = 0; i < 13; i++) {
    const z = 16 - boomLen / 2 + 3 + i * (boomLen / 12);
    for (const dx of [-5.5, 5.5]) parts.push(box(1.0, 4.4, 1.0, dx, boomY, z));
  }
  parts.push(box(12, 1.4, 3, 0, boomY, 16 + boomLen / 2 - 1.5));      // boom tip

  // ---- A-frame
  const lean = Math.atan2(16, 32);
  for (const x of [-gx, gx]) {
    for (const z of [-half * 0.55, half * 0.55]) {
      const b = new THREE.BoxGeometry(1.9, 40, 1.9);
      b.rotateX(lean * (z > 0 ? 1 : -1));
      b.translate(x, height + 18, z * 0.35);
      parts.push(b);
    }
  }
  parts.push(box(22, 2.0, 2.0, 0, height + 38, 2));                   // apex beam
  parts.push(box(2.0, 2.0, 24, -gx, height + 37, -8));
  parts.push(box(2.0, 2.0, 24, gx, height + 37, -8));

  // machinery house, trolley, cabin — kept shallow on the land side so the
  // backreach does not reach into the first yard row
  parts.push(box(14, 8, 8, 0, height + 7, -10));
  parts.push(box(6.0, 3.0, 6.0, 0, boomY + 3.6, 22));
  parts.push(box(3.6, 3.4, 3.6, 3.2, boomY - 2.6, 22));
  parts.push(box(4.0, 2.0, 4.0, 0, height - 0.8, -10));
  return merge(parts);
}

/* ------------------------------------------------------------------ yard cranes */
function yardCraneGeometry(span, height, cantilever = 0) {
  const parts = [];
  const half = span / 2;
  for (const z of [-4.5, 4.5]) {
    for (const x of [-half, half]) parts.push(box(1.5, height, 1.5, x, height / 2, z));
    parts.push(box(span + 1.5, 1.6, 1.6, 0, height - 0.8, z));
  }
  // main girder across the span
  parts.push(box(span + 2 * cantilever, 2.6, 2.6, 0, height + 1.3, 0));
  // trolley + cabin
  parts.push(box(4.0, 2.2, 4.0, 2, height + 3.4, 0));
  parts.push(box(2.4, 2.0, 2.4, -3.5, height - 2, 0));
  // cantilever end stops
  if (cantilever > 0) {
    parts.push(box(1.2, 1.2, 6, half + cantilever, height - 1, 0));
    parts.push(box(1.2, 1.2, 6, -half - cantilever, height - 1, 0));
  }
  return merge(parts);
}

function ohbcGeometry(span = 45.4, girderH = 28) {
  const parts = [];
  // two concrete girders running along the block
  for (const x of [-span / 2, span / 2]) {
    parts.push(box(2.2, 2.4, 60, x, girderH, 0));
    parts.push(box(1.6, girderH - 5, 1.6, x, (girderH - 5) / 2, -26));
    parts.push(box(1.6, girderH - 5, 1.6, x, (girderH - 5) / 2, 26));
  }
  // bridge
  parts.push(box(span + 4, 2.6, 6, 0, girderH + 2, 0));
  parts.push(box(4.5, 2.4, 5, 0, girderH - 2.5, 0));
  return merge(parts);
}

/* ------------------------------------------------------------------ placement */
export function buildQuayCranes(data, group) {
  const berths = data.berths.filter((b) => b.type === 'container');
  const placements = [];

  // Cranes are allocated per terminal and spread along that terminal's whole
  // frontage, not packed into the middle of each berth.  A terminal whose
  // quay is interrupted (PPT2, cut by PPAT) is split into contiguous groups
  // and each group gets cranes in proportion to its length.
  for (const t of data.terminals) {
    const list = berths.filter((b) => b.terminal === t.id);
    if (!list.length || !t.qc) continue;

    const groups = [];
    for (const b of list) {
      const g = groups[groups.length - 1];
      if (g && Math.hypot(g.end[0] - b.a[0], g.end[1] - b.a[1]) < 60) {
        g.list.push(b);
        g.end = b.b;
      } else {
        groups.push({ list: [b], start: b.a, end: b.b });
      }
    }
    let totalLen = 0;
    for (const g of groups) {
      const pts = [g.start];
      for (const b of g.list) pts.push(b.b);
      g.segs = [];
      g.len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        g.segs.push({ a, c, L, s: g.len });
        g.len += L;
      }
      totalLen += g.len;
    }

    let left = t.qc;
    groups.forEach((g, gi) => {
      const n = gi === groups.length - 1
        ? left
        : Math.max(1, Math.round(t.qc * g.len / totalLen));
      left -= n;
      if (!n) return;
      const margin = Math.min(30, g.len * 0.05);
      const pitch = n > 1 ? (g.len - 2 * margin) / (n - 1) : 0;
      for (let i = 0; i < n; i++) {
        const s = n > 1 ? margin + i * pitch : g.len / 2;
        let seg = g.segs[g.segs.length - 1];
        for (const q of g.segs) if (s <= q.s + q.L) { seg = q; break; }
        const u = seg.L ? (s - seg.s) / seg.L : 0;
        const x = seg.a[0] + (seg.c[0] - seg.a[0]) * u;
        const z = seg.a[1] + (seg.c[1] - seg.a[1]) * u;
        let b = g.list[g.list.length - 1], acc = 0;
        for (const q of g.list) {
          const bl = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
          if (s <= acc + bl) { b = q; break; }
          acc += bl;
        }
        const setback = 20;      // rail centre sits behind the coping
        // the quay normal is perpendicular to this very segment; the berth's
        // water-side normal only fixes which side is seaward
        const tx = seg.L ? (seg.c[0] - seg.a[0]) / seg.L : 1;
        const tz = seg.L ? (seg.c[1] - seg.a[1]) / seg.L : 0;
        let nx = -tz, nz = tx;
        if (nx * b.normal[0] + nz * b.normal[1] < 0) { nx = -nx; nz = -nz; }
        placements.push({
          x: x - nx * setback,
          z: z - nz * setback,
          rot: Math.atan2(nx, nz),
          mega: b.depth >= 16,
        });
      }
    });
  }

  const mega = placements.filter((p) => p.mega);
  const std = placements.filter((p) => !p.mega);

  const build = (list, geo, color) => {
    const m = instanced(geo, mat(color, { roughness: 0.55, metalness: 0.25 }), list.length);
    list.forEach((p, i) => {
      setInst(m, i, p.x, 5, p.z, 1, 1, 1, p.rot);
      m.setColorAt(i, new THREE.Color(color).offsetHSL(0, 0, (i % 5) * 0.012 - 0.02));
    });
    m.instanceColor.needsUpdate = true;
    group.add(m);
    return m;
  };
  build(mega, qcGeometry(56, 52), PAL.crane);
  build(std, qcGeometry(46, 44), PAL.crane);

  // blue accent boxes (machine house roofs) — read as PSA livery at distance
  const accent = [...mega, ...std];
  const am = instanced(box(16, 1.2, 13), mat(PAL.craneBlue, { roughness: 0.5 }), accent.length);
  accent.forEach((p, i) => setInst(am, i, p.x, 5 + (p.mega ? 58.4 : 50.4), p.z, 1, 1, 1, p.rot));
  group.add(am);

  return placements.length;
}

export function buildYardCranes(data, group) {
  const rmgGeo = yardCraneGeometry(34, 21, 4);      // 32–36 m blocks (north bank, east arm)
  const rtgGeo = yardCraneGeometry(25, 18, 0);      // 19.5 m blocks (west block)
  const ohbcGeo = ohbcGeometry();

  const rmg = [], rtg = [], ohbc = [];
  // `yc` is a 0/1 flag per block: one yard crane per RTG block, one per two
  // RMG blocks.  `yc_t` places it at the block end (+0.5 / −0.5 of its own
  // length), which is where RTGs/RMGs actually park and work from.
  for (const y of data.yards) {
    if (!y.yc) continue;
    const rad = (y.angle * Math.PI) / 180;
    const sa = Math.sin(rad), ca = Math.cos(rad);
    const off = (y.yc_t ?? -0.5) * y.l / 2;
    const item = { x: y.c[0] + off * sa, z: y.c[1] + off * ca, rot: rad };
    if (y.crane === 'OHBC') ohbc.push(item);
    else if (y.crane === 'RMG') rmg.push(item);
    else rtg.push(item);
  }

  const mk = (list, geo, color) => {
    if (!list.length) return 0;
    const m = instanced(geo, mat(color, { roughness: 0.6, metalness: 0.2 }), list.length);
    list.forEach((p, k) => setInst(m, k, p.x, 5, p.z, 1, 1, 1, p.rot));
    group.add(m);
    return list.length;
  };

  return mk(rmg, rmgGeo, PAL.rmg) + mk(rtg, rtgGeo, PAL.rmg) + mk(ohbc, ohbcGeo, 0x9ba3a8);
}

/* ------------------------------------------------------------------ trucks */
function pointInPoly(x, z, poly) {
  let c = false;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    if ((z1 > z) !== (z2 > z)) {
      const xi = x1 + ((z - z1) * (x2 - x1)) / (z2 - z1);
      if (x < xi) c = !c;
    }
  }
  return c;
}

function inYardBlock(x, z, yards) {
  for (const y of yards) {
    const rad = (y.angle * Math.PI) / 180;
    const ca = Math.cos(rad), sa = Math.sin(rad);
    const dx = x - y.c[0], dz = z - y.c[1];
    const lx = dx * ca - dz * sa;
    const lz = dx * sa + dz * ca;
    if (Math.abs(lx) <= y.w / 2 + 1.2 && Math.abs(lz) <= y.l / 2 + 1.2) return true;
  }
  return false;
}

function nearestYardDist(x, z, yards) {
  let best = Infinity;
  for (const y of yards) {
    const rad = (y.angle * Math.PI) / 180;
    const ca = Math.cos(rad), sa = Math.sin(rad);
    const dx = x - y.c[0], dz = z - y.c[1];
    const lx = dx * ca - dz * sa;
    const lz = dx * sa + dz * ca;
    const ox = Math.max(Math.abs(lx) - y.w / 2, 0);
    const oz = Math.max(Math.abs(lz) - y.l / 2, 0);
    best = Math.min(best, Math.hypot(ox, oz));
  }
  return best;
}

/** True when (x,z) is on the 180 m quay apron built in terminal.js. */
function onApron(x, z, data) {
  const qp = data.quay_chains[0].pts;
  let best = null;
  for (let i = 0; i < qp.length - 1; i++) {
    const a = qp[i], b = qp[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    const qx = a[0] + dx * t, qz = a[1] + dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (!best || d < best.d) best = { d, qx, qz };
  }
  if (!best || best.d > 160) return false;
  let bn = data.berths[0], bd = Infinity;
  for (const b of data.berths) {
    const d = Math.hypot(b.mid[0] - x, b.mid[1] - z);
    if (d < bd) { bd = d; bn = b; }
  }
  return (x - best.qx) * bn.normal[0] + (z - best.qz) * bn.normal[1] < 0;
}

export function buildTrucks(data, group) {
  const geo = merge([
    box(2.5, 2.9, 6.2, 0, 1.45, 4.4),        // cab
    box(2.55, 0.5, 12.6, 0, 0.55, -3.2),     // chassis
    box(2.44, 2.59, 12.19, 0, 2.5, -3.2),    // container
    box(0.9, 0.9, 0.9, 0, 0.45, 3.0),        // wheels hint
    box(0.9, 0.9, 0.9, 0, 0.45, -7.4),
  ]);
  // apron roads along the quay, plus the travel lanes between the container
  // rows: the internal trucks work the yard, so most of them belong there
  const roads = data.roads
    .filter((r) => r.type === 'quay')
    .map((r) => ({ ...r, spacing: 120 }))
    .concat((data.mainRoads || []).flatMap((r) =>
      r.pts.slice(1).map((p, i) => ({ a: r.pts[i], b: p, width: r.width, spacing: 220 }))))
    .concat((data.yardLanes || []).map((r) => ({ ...r, spacing: 150, kind: 'lane' })));

  const list = [];
  const rand = rng(21);
  const colors = [0xb3402f, 0x2a5c8a, 0x2e6b4f, 0xc07a2a, 0x8a8f93, 0xd8dcdd];
  roads.forEach((r, ri) => {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 40) return;
    const n = Math.max(1, Math.floor(len / r.spacing));
    const lane = Math.min(5, Math.max(2, (r.width ?? 20) / 2 - 3));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.35 + rand() * 0.3) / n;
      const side = (rand() > 0.5 ? 1 : -1) * (lane * (0.25 + rand() * 0.7));
      const x = r.a[0] + dx * t + (dz / len) * side;
      const z = r.a[1] + dz * t - (dx / len) * side;
      // the truck's long axis is local +Z; align it with the road
      const rot = Math.atan2(dx, dz) + (rand() > 0.5 ? 0 : Math.PI);
      const ux = Math.sin(rot), uz = Math.cos(rot);
      // keep the whole 13 m truck on land and out of the container blocks
      let ok = true;
      for (const s of [-5.5, 0, 5.5]) {
        const px = x + ux * s, pz = z + uz * s;
        if ((!pointInPoly(px, pz, data.land) && !onApron(px, pz, data)) ||
            inYardBlock(px, pz, data.yards)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // a yard lane through an empty area (PPAT, cleared apron) is not a
      // working aisle any more: no trucks there
      if (r.kind === 'lane' && nearestYardDist(x, z, data.yards) > 22) continue;
      list.push({ x, z, rot, color: colors[(ri + i) % colors.length] });
    }
  });
  const m = instanced(geo, mat(0xffffff, { roughness: 0.7 }), list.length);
  list.forEach((p, i) => {
    setInst(m, i, p.x, 5, p.z, 1, 1, 1, p.rot);
    m.setColorAt(i, new THREE.Color(p.color));
  });
  m.instanceColor.needsUpdate = true;
  group.add(m);
  return list.length;
}

/* ------------------------------------------------------------------ vessels */
/* ------------------------------------------------------------------ vessels */
function makeShip(v) {
  const g = new THREE.Group();
  const L = v.loa, B = v.beam;
  const isCar = v.type.includes('Car');
  const isFeeder = v.type.includes('Feeder');
  const draft = v.draft;
  const freeboard = isCar ? 22 : isFeeder ? 8 : 15;
  const H = draft + freeboard;

  // ---- hull
  const s = new THREE.Shape();
  s.moveTo(-L / 2, -B / 2);
  s.lineTo(L / 2 - L * 0.17, -B / 2);
  s.quadraticCurveTo(L / 2 - L * 0.035, -B * 0.30, L / 2, 0);
  s.quadraticCurveTo(L / 2 - L * 0.035, B * 0.30, L / 2 - L * 0.17, B / 2);
  s.lineTo(-L / 2, B / 2);
  s.lineTo(-L / 2, -B / 2);
  const hull = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false, curveSegments: 7 });
  hull.rotateX(-Math.PI / 2);
  hull.translate(0, -draft, 0);
  g.add(new THREE.Mesh(hull, mat(PAL.shipHull, { roughness: 0.72, metalness: 0.2 })));

  // white boot-top band just above the waterline
  g.add(new THREE.Mesh(box(L * 0.99, 1.4, B + 0.5, 0, 1.2, 0), mat(0x9aa6ae, { roughness: 0.6 })));
  // deck / hatch cover surface
  g.add(new THREE.Mesh(box(L * 0.86, 0.7, B * 0.94, -L * 0.03, freeboard - 0.35, 0),
    mat(PAL.shipDeck, { roughness: 0.85 })));

  // ---- accommodation block aft
  const hh = isCar ? 30 : isFeeder ? 16 : 26;
  const hw = isCar ? 0.9 : 0.72;
  g.add(new THREE.Mesh(box(0.085 * L, hh, B * hw, -L * 0.395, freeboard + hh / 2, 0),
    mat(PAL.shipHouse, { roughness: 0.55 })));
  // bridge wings
  g.add(new THREE.Mesh(box(0.03 * L, 5, B * 0.99, -L * 0.375, freeboard + hh - 2.5, 0),
    mat(0xe8ecef, { roughness: 0.5 })));
  // funnel
  g.add(new THREE.Mesh(box(0.045 * L, 11, B * 0.26, -L * 0.445, freeboard + hh + 4, 0), mat(0x24333d)));

  // ---- cargo
  if (isCar) {
    // car carrier: tall slab-sided decks with a small superstructure
    for (let i = 0; i < 4; i++) {
      g.add(new THREE.Mesh(box(L * 0.74, 6, B * 0.92, L * 0.04, freeboard + 3 + i * 6, 0),
        mat(i % 2 ? 0x8e979d : 0xa2abb1, { roughness: 0.6 })));
    }
  } else {
    const tiers = isFeeder ? 3 : v.loa > 380 ? 7 : 6;
    const bayLen = 13.2;
    const firstBay = -L * 0.30;
    const lastBay = L * 0.43;
    const bays = Math.floor((lastBay - firstBay) / bayLen);
    const rowsAcross = 3;                       // 3 visual blocks across the beam
    const rowW = (B * 0.82) / rowsAcross;
    const stack = new Map();
    const push = (hex, geo) => {
      if (!stack.has(hex)) stack.set(hex, []);
      stack.get(hex).push(geo);
    };
    for (let b = 0; b < bays; b++) {
      const bx = firstBay + b * bayLen + bayLen / 2;
      // stack height tapers towards the bow
      const taper = b / bays;
      const h = Math.max(1, Math.round(tiers - taper * 2.2));
      for (let t = 0; t < h; t++) {
        for (let r = 0; r < rowsAcross; r++) {
          const rz = -B * 0.41 + (r + 0.5) * rowW;
          const hex = [0xb3402f, 0x2a5c8a, 0x2e6b4f, 0xc07a2a, 0x9aa0a6, 0xd8dcdd, 0x1f6f8b][(b * 3 + t + r * 2) % 7];
          push(hex, box(bayLen - 0.5, 2.59, rowW - 0.4, bx, freeboard + 1.35 + t * 2.62, rz));
        }
      }
      // lashing bridge every 4 bays
      if (b % 4 === 0) {
        g.add(new THREE.Mesh(box(0.8, tiers * 2.62, B * 0.86, bx - bayLen / 2, freeboard + tiers * 1.31, 0),
          mat(0x3d4a53, { roughness: 0.8 })));
      }
    }
    for (const [hex, list] of stack) g.add(new THREE.Mesh(merge(list), mat(hex, { roughness: 0.78 })));
    // forecastle
    g.add(new THREE.Mesh(box(L * 0.09, 3, B * 0.7, L * 0.455, freeboard + 1.5, 0), mat(0x596570)));
  }
  return g;
}

export function buildVessels(data, group) {
  const byBerth = new Map(data.berths.map((b) => [b.id, b]));
  const out = [];
  for (const v of data.vessels) {
    const b = byBerth.get(v.berth);
    if (!b) continue;
    const ship = makeShip(v);
    // berth tangent â†’ ship heading along the quay
    const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1];
    const rot = Math.atan2(-dz, dx);
    ship.position.set(b.mid[0] + b.normal[0] * (v.beam / 2 + 26), 0, b.mid[1] + b.normal[1] * (v.beam / 2 + 26));
    ship.rotation.y = rot;
    ship.name = 'vessel_' + v.id;
    group.add(ship);
    out.push(v);
  }
  return out;
}

