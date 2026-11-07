import * as THREE from 'three';
import { PAL, mat, box, merge, ribbon, instanced, setInst } from './geo.js';

const DECK = 5.0;

/* ------------------------------------------------------------------ paving */
const PAVING_TILE = 24;        // metres between expansion joints

/**
 * One concrete sheet with faint panel joints, repeated across the yard.
 * Without it every apron reads as a flat grey plate, which is what an empty
 * stack of blocks looks like from the air.
 */
function pavingTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#c9ced1';
  x.fillRect(0, 0, S, S);

  let seed = 20261106;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 5200; i++) {
    const v = 176 + Math.floor(rnd() * 58);
    x.fillStyle = `rgba(${v},${v + 2},${v + 3},0.28)`;
    const s = 1.5 + rnd() * 5;
    x.fillRect(rnd() * S, rnd() * S, s, s);
  }
  // half-tile panel joints, then the heavier expansion joint on the tile edge
  x.strokeStyle = 'rgba(126,133,137,0.42)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(S / 2, 0); x.lineTo(S / 2, S);
  x.moveTo(0, S / 2); x.lineTo(S, S / 2);
  x.stroke();
  x.strokeStyle = 'rgba(84,91,96,0.80)';
  x.lineWidth = 2.4;
  x.beginPath();
  x.moveTo(0, 1.2); x.lineTo(S, 1.2);
  x.moveTo(1.2, 0); x.lineTo(1.2, S);
  x.stroke();

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let _pavingTex = null;
function pavingMat(tint) {
  if (!_pavingTex) _pavingTex = pavingTexture();
  return new THREE.MeshStandardMaterial({
    map: _pavingTex, color: tint, roughness: 0.95, metalness: 0.02,
  });
}

/** World-space planar UVs: one joint grid across plates of any size. */
function projectUV(geo, tile) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

let _laneMat = null;
function laneMat() {
  if (!_laneMat) {
    _laneMat = new THREE.MeshStandardMaterial({
      color: 0x5a6065, roughness: 0.97, metalness: 0.02,
      // the lane strips are coplanar with the apron plates; bias them towards
      // the camera instead of stacking tenths of a metre of fake height
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  return _laneMat;
}

/* ------------------------------------------------------------------ helpers */
function polyShape(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, z) : s.moveTo(x, z)));
  s.closePath();
  return s;
}

/** Extrude a plan polygon into a slab whose top face sits at `top`. */
function extrudeSlab(pts, top, thickness, material) {
  const geo = new THREE.ExtrudeGeometry(polyShape(pts), { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);          // shape XY -> world XZ, extrusion -> -Y
  geo.translate(0, top, 0);
  const m = new THREE.Mesh(geo, material);
  m.material.side = THREE.DoubleSide;
  return m;
}

function chainPolylines(data) {
  if (data.quay_chains) return data.quay_chains.map((c) => ({ chain: c.id, pts: c.pts }));
  const byChain = new Map();
  for (const b of data.berths) {
    if (!byChain.has(b.chain)) byChain.set(b.chain, []);
    byChain.get(b.chain).push(b);
  }
  const out = [];
  for (const [, list] of byChain) {
    list.sort((a, b) => a.index - b.index);
    const pts = [list[0].a];
    for (const b of list) pts.push(b.b);
    out.push({ chain: list[0].chain, pts });
  }
  return out;
}

/* ------------------------------------------------------------------ terminal */
export function buildTerminal(data, group) {
  /* ---- land masses */
  group.add(extrudeSlab(data.land, DECK, 11, mat(PAL.land, { roughness: 1 })));
  if (data.east && data.east.length > 2) {
    group.add(extrudeSlab(data.east, DECK, 11, mat(PAL.land, { roughness: 1 })));
  }

  /* ---- quay apron
     The land polygon stops short of the OSM quay chain in places (up to
     ~45 m on the east arm).  This ribbon fills the gap and forms the quay
     wall, so the apron roads, cranes and first yard row sit on deck. */
  if (data.quay_chains && data.quay_chains.length) {
    const qp = data.quay_chains[0].pts;
    const segN = [];
    for (let i = 0; i < qp.length - 1; i++) {
      const mx = (qp[i][0] + qp[i + 1][0]) / 2;
      const mz = (qp[i][1] + qp[i + 1][1]) / 2;
      let best = data.berths[0], bd = Infinity;
      for (const b of data.berths) {
        const d = Math.hypot(b.mid[0] - mx, b.mid[1] - mz);
        if (d < bd) { bd = d; best = b; }
      }
      segN.push(best.normal);
    }
    const inland = [];
    for (let i = 0; i < qp.length; i++) {
      const ns = [];
      if (i > 0) ns.push(segN[i - 1]);
      if (i < segN.length) ns.push(segN[i]);
      let nx = ns.reduce((s, n) => s + n[0], 0) / ns.length;
      let nz = ns.reduce((s, n) => s + n[1], 0) / ns.length;
      const L = Math.hypot(nx, nz) || 1;
      nx /= L; nz /= L;
      const c = Math.max(0.35, Math.abs(nx * ns[0][0] + nz * ns[0][1]));
      const sc = 1 / c;
      inland.push([qp[i][0] - nx * 180 * sc, qp[i][1] - nz * 180 * sc]);
    }
    const pos = [];
    const quad = (a, b, c, d) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    };
    const TOP = DECK + 0.01, BOT = DECK - 6;
    for (let i = 0; i < qp.length - 1; i++) {
      const a = qp[i], b = qp[i + 1], ai = inland[i], bi = inland[i + 1];
      const aT = [a[0], TOP, a[1]], bT = [b[0], TOP, b[1]];
      const aiT = [ai[0], TOP, ai[1]], biT = [bi[0], TOP, bi[1]];
      const aB = [a[0], BOT, a[1]], bB = [b[0], BOT, b[1]];
      const aiB = [ai[0], BOT, ai[1]], biB = [bi[0], BOT, bi[1]];
      quad(aT, bT, biT, aiT);          // top
      quad(aT, bT, bB, aB);            // quay wall
      quad(aiT, biT, biB, aiB);        // inland wall
      if (i === 0) quad(aT, aB, aiB, aiT);
      if (i === qp.length - 2) quad(bT, biT, biB, bB);
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ag.computeVertexNormals();
    group.add(new THREE.Mesh(ag, mat(PAL.land, { roughness: 1, side: THREE.DoubleSide })));
  }

  /* ---- quay edge: coping, fenders, bollards */
  const coping = [];
  const fenders = [];
  const bollards = [];
  for (const { pts } of chainPolylines(data)) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 4) continue;
      const ang = Math.atan2(-dz, dx);

      const c = new THREE.BoxGeometry(len, 1.3, 3.2);
      c.rotateY(ang);
      c.translate((ax + bx) / 2, DECK + 0.15, (az + bz) / 2);
      coping.push(c);

      const nx = dz / len, nz = -dx / len;
      const n = Math.max(2, Math.floor(len / 26));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = ax + dx * t, z = az + dz * t;
        const f = new THREE.BoxGeometry(2.2, 3.4, 1.4);
        f.rotateY(ang);
        f.translate(x + nx * 1.1, 1.6, z + nz * 1.1);
        fenders.push(f);
        const b = new THREE.CylinderGeometry(0.55, 0.62, 1.1, 8);
        b.translate(x - nx * 3.0, DECK + 0.55, z - nz * 3.0);
        bollards.push(b);
      }
    }
  }
  group.add(new THREE.Mesh(merge(coping), mat(PAL.concrete, { roughness: 0.9 })));
  group.add(new THREE.Mesh(merge(fenders), mat(0x1b1e21, { roughness: 1 })));
  group.add(new THREE.Mesh(merge(bollards), mat(0x2a2d30, { metalness: 0.4 })));

  /* ---- yard slabs + crane rails */
  const slabs = [];
  const rails = [];
  for (const y of data.yards) {
    const [cx, cz] = y.c;
    // block local: w across X, l along Z; `angle` rotates that frame onto the
    // block's bearing (120.7° west / 30.7° east)
    const rad = (y.angle * Math.PI) / 180;
    const ca = Math.cos(rad), sa = Math.sin(rad);
    const s = new THREE.BoxGeometry(y.w, 0.22, y.l);
    if (rad) s.rotateY(rad);
    s.translate(cx, DECK + 0.11, cz);
    slabs.push(projectUV(s, PAVING_TILE));
    for (const off of [-y.w / 2 + 2.2, y.w / 2 - 2.2]) {
      const r = new THREE.BoxGeometry(1.4, 0.3, y.l);
      if (rad) r.rotateY(rad);
      r.translate(cx + off * ca, DECK + 0.22, cz - off * sa);
      rails.push(r);
    }
  }
  group.add(new THREE.Mesh(merge(slabs), pavingMat(0xa2a8ab)));

  /* ---- yard aprons: one paving plate per zone, so the aisles between lanes
     read as concrete instead of the dark land plate. Planar UVs are computed
     in world space, so the joint grid runs continuously across every plate. */
  if (data.yardZones) {
    const ap = [];
    for (const z of data.yardZones) {
      const rad = (z.angle * Math.PI) / 180;
      const g = new THREE.PlaneGeometry(z.w, z.l);
      g.rotateX(-Math.PI / 2);
      if (rad) g.rotateY(rad);
      g.translate(z.c[0], DECK + 0.12, z.c[1]);
      ap.push(projectUV(g, PAVING_TILE));
    }
    group.add(new THREE.Mesh(merge(ap), pavingMat(0x797f84)));
  }

  /* ---- yard travel lanes: the asphalt strip between two container rows.
     These are the roads the internal trucks actually use, so they follow the
     block grid rather than the quay. */
  if (data.yardLanes) {
    const lg = data.yardLanes.map((r) =>
      ribbon(r.a[0], r.a[1], r.b[0], r.b[1], r.width, DECK + 0.17));
    group.add(new THREE.Mesh(merge(lg), laneMat()));
  }

  /* ---- terminal sheds: low service buildings along the back of the yard */
  if (data.sheds && data.sheds.length) {
    const shedWalls = [];
    const shedRoofs = [];
    for (const b of data.sheds) {
      const rad = (b.angle * Math.PI) / 180;
      const w = box(b.w, b.h, b.l, b.c[0], DECK + b.h / 2, b.c[1], rad);
      const r = box(b.w * 1.04, 0.8, b.l * 1.03, b.c[0], DECK + b.h + 0.3, b.c[1], rad);
      shedWalls.push(w);
      shedRoofs.push(r);
    }
    group.add(new THREE.Mesh(merge(shedWalls), mat(0xa9aeb1, { roughness: 0.85 })));
    group.add(new THREE.Mesh(merge(shedRoofs), mat(0x7f868b, { roughness: 0.9 })));
  }
  group.add(new THREE.Mesh(merge(rails), mat(0xb9bfc4, { metalness: 0.6, roughness: 0.4 })));

  /* ---- roads */
  // `data.roads` are the quay apron roads (one straight ribbon each); the
  // named internal network (Avenue/Drive/Link) arrives as polylines in
  // `data.mainRoads` and is flattened into the same ribbon pass.
  const allRoads = data.roads.slice();
  for (const r of data.mainRoads || []) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      allRoads.push({ a: r.pts[i], b: r.pts[i + 1], width: r.width, type: 'main' });
    }
  }

  const roadGeos = [];
  const dashes = [];
  for (const r of allRoads) {
    const [ax, az] = r.a, [bx, bz] = r.b;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 6) continue;
    roadGeos.push(ribbon(ax, az, bx, bz, r.width, DECK + 0.06));
    const ang = Math.atan2(-dz, dx);
    const n = Math.floor(len / 14);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const g = new THREE.BoxGeometry(5.5, 0.05, 0.32);
      g.rotateY(ang);
      g.translate(ax + dx * t, DECK + 0.10, az + dz * t);
      dashes.push(g);
    }
  }
  group.add(new THREE.Mesh(merge(roadGeos), mat(PAL.asphalt, { roughness: 0.96 })));
  group.add(new THREE.Mesh(merge(dashes), mat(0xb9b2a2, { roughness: 0.8 })));

  /* ---- light masts */
  const mastGeo = merge([
    new THREE.CylinderGeometry(0.45, 0.7, 30, 8).translate(0, 15, 0),
    new THREE.BoxGeometry(5.5, 0.6, 1.4).translate(0, 30.2, 0),
  ]);
  const masts = [];
  for (const r of allRoads) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 30) continue;
    const n = Math.max(1, Math.floor(len / 220));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = r.a[0] + dx * t;
      const pz = r.a[1] + dz * t;
      let ox, oz;
      if (r.type === 'quay') {
        // put the mast on the seaward verge (between the road and the quay),
        // never on the yard side where it could stand inside a block
        let best = data.berths[0], bd = Infinity;
        for (const b of data.berths) {
          const d = Math.hypot(b.mid[0] - px, b.mid[1] - pz);
          if (d < bd) { bd = d; best = b; }
        }
        ox = best.normal[0] * (r.width / 2 + 3);
        oz = best.normal[1] * (r.width / 2 + 3);
      } else {
        ox = (dz / len) * (r.width / 2 + 4);
        oz = -(dx / len) * (r.width / 2 + 4);
      }
      masts.push([px + ox, pz + oz]);
    }
  }
  const mm = instanced(mastGeo, mat(0x8d9499, { metalness: 0.4 }), masts.length);
  masts.forEach((p, i) => setInst(mm, i, p[0], DECK, p[1]));
  group.add(mm);

  /* ---- gate complex */
  const g = data.gate;
  const gate = new THREE.Group();
  const laneTotal = (g.in_lanes + g.out_lanes) * g.lane_w;
  const halfW = laneTotal / 2;

  gate.add(new THREE.Mesh(box(laneTotal + 16, 1.4, 30, 0, g.canopy_h, 30), mat(PAL.gate, { roughness: 0.6, metalness: 0.2 })));
  const cols = [];
  for (let i = 0; i <= 6; i++) {
    const cx = -halfW - 6 + (i / 6) * (laneTotal + 12);
    cols.push(box(1.2, g.canopy_h, 1.2, cx, g.canopy_h / 2, 18));
    cols.push(box(1.2, g.canopy_h, 1.2, cx, g.canopy_h / 2, 42));
  }
  gate.add(new THREE.Mesh(merge(cols), mat(PAL.concrete)));
  const booths = [];
  for (let i = 0; i <= g.in_lanes + g.out_lanes; i++) {
    booths.push(box(1.6, 3.2, 5.2, -halfW + i * g.lane_w, 1.6, 30));
  }
  gate.add(new THREE.Mesh(merge(booths), mat(0xe4e7e9, { roughness: 0.7 })));
  gate.add(new THREE.Mesh(box(110, 16, 60, halfW + 90, 8, 60), mat(0x9aa1a5, { roughness: 0.75 })));
  gate.add(new THREE.Mesh(box(70, 26, 40, -halfW - 90, 13, 55), mat(0xb9c0c4, { roughness: 0.55, metalness: 0.15 })));
  gate.position.set(g.x, DECK, g.z - 40);
  gate.rotation.y = g.rot ?? -0.20;
  group.add(gate);

  /* ---- terminal zones: coloured apron + berth ticks */
  const TERM_COLOR = {};
  for (const t of data.terminals || []) TERM_COLOR[t.id] = t.color;

  const zoneGroup = new THREE.Group();
  zoneGroup.name = 'zones';
  const allTicks = [];
  const byTerm = new Map();
  for (const b of data.berths) {
    if (!byTerm.has(b.terminal)) byTerm.set(b.terminal, []);
    byTerm.get(b.terminal).push(b);
  }
  for (const [tid, list] of byTerm) {
    const geos = [];
    for (const b of list) {
      const dx = b.b[0] - b.a[0], dz = b.b[1] - b.a[1];
      const len = Math.hypot(dx, dz);
      if (len < 2) continue;
      const ang = Math.atan2(-dz, dx);
      const nx = b.normal[0], nz = b.normal[1];
      const g = new THREE.BoxGeometry(Math.max(len - 2, 2), 0.7, 17);
      g.rotateY(ang);
      g.translate(b.mid[0] - nx * 14, DECK + 0.34, b.mid[1] - nz * 14);
      geos.push(g);
      const t = new THREE.BoxGeometry(1.3, 0.45, 24);
      t.rotateY(ang);
      t.translate(b.a[0] - nx * 2.5, DECK + 0.3, b.a[1] - nz * 2.5);
      allTicks.push(t);
    }
    if (geos.length) {
      zoneGroup.add(new THREE.Mesh(merge(geos), mat(TERM_COLOR[tid] || '#ffffff', { roughness: 0.65 })));
    }
  }
  zoneGroup.add(new THREE.Mesh(merge(allTicks), mat(0xeef4f7, { roughness: 0.55 })));
  group.add(zoneGroup);

  /* ---- labels */
  const labels = new THREE.Group();
  const cache = new Map();
  const labelTex = (text, color, sub) => {
    const key = text + color + (sub || '');
    if (cache.has(key)) return cache.get(key);
    const W = 192, H = sub ? 120 : 96;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,12,17,0.80)';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = color; x.lineWidth = 5; x.strokeRect(2.5, 2.5, W - 5, H - 5);
    x.fillStyle = color;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold ' + (sub ? 52 : 56) + 'px "JetBrains Mono", monospace';
    x.fillText(text, W / 2, sub ? 46 : H / 2);
    if (sub) {
      x.fillStyle = 'rgba(220,232,240,0.82)';
      x.font = '16px "JetBrains Mono", monospace';
      x.fillText(sub, W / 2, 88);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
    return t;
  };

  for (const b of data.berths) {
    const color = TERM_COLOR[b.terminal] || '#c9d6e2';
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTex(b.id, color), transparent: true, depthTest: false, depthWrite: false,
    }));
    sp.position.set(b.mid[0] + b.normal[0] * 28, DECK + 17, b.mid[1] + b.normal[1] * 28);
    sp.scale.set(40, 20, 1);
    labels.add(sp);
  }

  /* ---- terminal name plates */
  for (const t of data.terminals || []) {
    // the anchor is the centroid of the terminal's own yard area, so the
    // plate sits on its block instead of on the quay line or on a berth
    // whose normal happens to point inland
    if (!t.anchor) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTex(t.id === 'PPAT' ? 'PPAT' : t.id.replace('PPT', 'PPT '), t.color, t.berth_range),
      transparent: true, depthTest: false, depthWrite: false,
      sizeAttenuation: false,          // constant on-screen size at any zoom
    }));
    sp.position.set(t.anchor[0], DECK + 34, t.anchor[1]);
    sp.scale.set(0.086, 0.0538, 1);
    sp.name = 'terminal_' + t.id;
    labels.add(sp);
  }
  labels.name = 'labels';
  group.add(labels);

  return { labels, zones: zoneGroup };
}

/* ------------------------------------------------------------------ water */
export function buildWater(data, group) {
  const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(PAL.waterDeep) },
    uShallow: { value: new THREE.Color(PAL.water) },
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow;
      varying vec3 vW;
      void main(){
        float w = sin(vW.x*0.012 + uTime*0.28) * 0.5 + sin(vW.z*0.009 - uTime*0.21) * 0.5;
        float w2 = sin((vW.x+vW.z)*0.031 + uTime*0.5) * 0.5;
        vec3 col = mix(uDeep, uShallow, 0.62 + 0.22*w + 0.10*w2);
        float sheen = smoothstep(0.82, 1.0, sin(vW.z*0.004 + vW.x*0.0016 + uTime*0.15));
        col += sheen * 0.035;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(500, 0, 800);
  mesh.renderOrder = -1;
  group.add(mesh);
  return { mesh, uniforms };
}
