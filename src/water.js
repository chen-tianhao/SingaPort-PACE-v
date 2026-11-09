import * as THREE from 'three';
import { PAL, mat, box, merge, ribbon, instanced, setInst } from './geo.js';

function textSprite(text, { color = '#bfe3f5', bg = 'rgba(6,16,24,0.72)', w = 512, h = 128, fs = 46 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = color; x.lineWidth = 3; x.globalAlpha = 0.5;
  x.strokeRect(2, 2, w - 4, h - 4); x.globalAlpha = 1;
  x.fillStyle = color;
  x.font = `600 ${fs}px "JetBrains Mono", monospace`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, depthTest: false, depthWrite: false, opacity: 0.95,
  }));
  s.scale.set(w / 2.2, h / 2.2, 1);
  return s;
}

export function buildChannels(data, group) {
  const g = new THREE.Group();
  if (!data.channels?.length && !data.anchorages?.length) return g;
  const surfaces = [];
  const centres = [];
  for (const ch of data.channels) {
    const pts = ch.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      surfaces.push(ribbon(ax, az, bx, bz, ch.width, 0.32));
      // centre line dashes
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz), ang = Math.atan2(-dz, dx);
      const n = Math.floor(len / 55);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const d = new THREE.BoxGeometry(26, 0.08, 1.6);
        d.rotateY(ang);
        d.translate(ax + dx * t, 0.42, az + dz * t);
        centres.push(d);
      }
    }
    // label at the middle of the polyline
    const mid = pts[Math.floor(pts.length / 2)];
    const lb = textSprite(ch.name, { color: '#8fd3f0', fs: 40 });
    lb.position.set(mid[0], 26, mid[1]);
    g.add(lb);
  }
  const surf = new THREE.Mesh(merge(surfaces), new THREE.MeshBasicMaterial({
    color: PAL.channel, transparent: true, opacity: 0.13, depthWrite: false,
  }));
  surf.renderOrder = 1;
  g.add(surf);
  g.add(new THREE.Mesh(merge(centres), new THREE.MeshBasicMaterial({
    color: PAL.channelHot, transparent: true, opacity: 0.35, depthWrite: false,
  })));

  // anchorages — outline only
  const rings = [];
  for (const a of data.anchorages) {
    const hw = a.w / 2, hd = a.d / 2;
    const segs = [
      [a.x - hw, a.z - hd, a.x + hw, a.z - hd],
      [a.x + hw, a.z - hd, a.x + hw, a.z + hd],
      [a.x + hw, a.z + hd, a.x - hw, a.z + hd],
      [a.x - hw, a.z + hd, a.x - hw, a.z - hd],
    ];
    for (const [x1, z1, x2, z2] of segs) rings.push(ribbon(x1, z1, x2, z2, 6, 0.4));
    const lb = textSprite(a.name, { color: '#f0c07a', fs: 34 });
    lb.position.set(a.x, 24, a.z - a.d / 2 + 60);
    g.add(lb);
  }
  g.add(new THREE.Mesh(merge(rings), new THREE.MeshBasicMaterial({
    color: 0xf0a04b, transparent: true, opacity: 0.5, depthWrite: false,
  })));

  g.name = 'channels';
  group.add(g);
  return g;
}

export function buildBuoys(data, group) {
  // IALA region A marks around the approach
  const marks = [
    { x: 3520, z: 4530, type: 'red', name: 'BERLAYAR' },
    { x: 3050, z: 4420, type: 'green', name: 'PP-1' },
    { x: 1700, z: 3960, type: 'red', name: 'PP-2' },
    { x: 640, z: 3700, type: 'green', name: 'SINKI' },
    { x: -140, z: 3300, type: 'red', name: 'JC-1' },
    { x: -620, z: 2900, type: 'green', name: 'JC-2' },
    { x: 900, z: 3620, type: 'yellow', name: 'W3' },
    { x: 2200, z: 4300, type: 'yellow', name: 'PP-3' },
  ];
  const bodies = [];
  const lights = [];
  for (const m of marks) {
    const h = m.type === 'yellow' ? 4.5 : 6;
    bodies.push(box(3.2, h, 3.2, m.x, h / 2, m.z));
    const col = m.type === 'red' ? PAL.buoyRed : m.type === 'green' ? PAL.buoyGreen : 0xd8b23a;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6),
      new THREE.MeshBasicMaterial({ color: col }));
    l.position.set(m.x, h + 0.8, m.z);
    lights.push(l);
  }
  group.add(new THREE.Mesh(merge(bodies), mat(0x2a2f33, { metalness: 0.3 })));
  lights.forEach((l) => group.add(l));
}

export function addFog(scene, color) {
  scene.fog = new THREE.Fog(color, 4000, 22000);
}
