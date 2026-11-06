import * as THREE from 'three';
import { PAL, mat, box, merge, ribbon, instanced, setInst } from './geo.js';

const DECK = 5.0;

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
    slabs.push(s);
    for (const off of [-y.w / 2 + 2.2, y.w / 2 - 2.2]) {
      const r = new THREE.BoxGeometry(1.4, 0.3, y.l);
      if (rad) r.rotateY(rad);
      r.translate(cx + off * ca, DECK + 0.22, cz - off * sa);
      rails.push(r);
    }
  }
  group.add(new THREE.Mesh(merge(slabs), mat(PAL.yard, { roughness: 0.95 })));

  /* ---- yard aprons: one concrete plate per zone, so the aisles between
     lanes read as paving instead of the dark land plate */
  if (data.yardZones) {
    const ap = [];
    for (const z of data.yardZones) {
      const rad = (z.angle * Math.PI) / 180;
      const g = new THREE.BoxGeometry(z.w, 0.16, z.l);
      if (rad) g.rotateY(rad);
      g.translate(z.c[0], DECK + 0.05, z.c[1]);
      ap.push(g);
    }
    group.add(new THREE.Mesh(merge(ap), mat(0x6f7579, { roughness: 0.96 })));
  }
  group.add(new THREE.Mesh(merge(rails), mat(0xb9bfc4, { metalness: 0.6, roughness: 0.4 })));

  /* ---- roads */
  const roadGeos = [];
  const dashes = [];
  for (const r of data.roads) {
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
  for (const r of data.roads) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 30) continue;
    const n = Math.max(1, Math.floor(len / 220));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      masts.push([r.a[0] + dx * t + (dz / len) * (r.width / 2 + 4),
                  r.a[1] + dz * t - (dx / len) * (r.width / 2 + 4)]);
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
  const rotY = -0.20;

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
  gate.rotation.y = rotY;
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
