import * as THREE from 'three';

/**
 * Optional identification tags (blocks / yard cranes / quay cranes / trucks).
 *
 * The tags are plain DOM elements projected onto the scene: with ~2,000 of them
 * a canvas-sprite per tag would cost far too much texture memory, while a DOM
 * overlay only touches the few hundred tags that are actually on screen.  The
 * layer is built lazily on the first toggle and is off by default.
 */
const LIMITS = { block: 800, yc: 260, qc: 750, truck: 260 };

export function buildIds(data, groups) {
  const layer = document.createElement('div');
  layer.id = 'id-layer';
  document.body.appendChild(layer);

  const termColor = new Map((data.terminals || []).map((t) => [t.id, t.color]));
  const paint = (el, term) => {
    const hex = termColor.get(term) || '#7f8a92';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    el.style.background = `rgba(${r},${g},${b},0.9)`;
    el.style.color = lum > 0.62 ? '#11161a' : '#ffffff';
    el.style.borderColor = 'rgba(255,255,255,0.36)';
  };

  const items = [];
  const add = (code, x, y, z, type, term) => {
    if (!code) return;
    const el = document.createElement('div');
    el.className = `idtag ${type}`;
    el.textContent = code;
    paint(el, term);
    layer.appendChild(el);
    items.push({ x, y, z, type, term, el, limit: LIMITS[type] });
  };

  for (const b of data.yards) add(b.code, b.c[0], 24, b.c[1], 'block', b.terminal);
  for (const p of (groups.yardcranes?.userData?.yardCranes || [])) {
    add(p.code, p.x, 36, p.z, 'yc', p.terminal);
  }
  for (const p of (groups.cranes?.userData?.quayCranes || [])) {
    add(p.code, p.x, 64, p.z, 'qc', p.terminal);
  }
  for (const p of (groups.trucks?.userData?.trucks || [])) {
    add(p.code, p.x, 10, p.z, 'truck', p.terminal);
  }

  let visible = false;
  let timer = 0;
  const v = new THREE.Vector3();

  function update(cam, camera, dt) {
    if (!visible) return;
    timer += dt;
    if (timer < 0.08) return;              // ~12 Hz is plenty for a label layer
    timer = 0;
    const w = window.innerWidth, h = window.innerHeight;
    const cand = [];
    for (const it of items) {
      const dx = cam.x - it.x, dz = cam.z - it.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > it.limit * it.limit) {
        if (it.el.style.display !== 'none') it.el.style.display = 'none';
        continue;
      }
      v.set(it.x, it.y, it.z).project(camera);
      if (v.z < -1 || v.z > 1) {
        it.el.style.display = 'none';
        continue;
      }
      cand.push({
        it, d2,
        sx: (v.x * 0.5 + 0.5) * w,
        sy: (-v.y * 0.5 + 0.5) * h,
      });
    }
    // nearest first; drop a tag when it would collide with one already placed
    cand.sort((a, b) => a.d2 - b.d2);
    const placed = [];
    for (const c of cand) {
      let clash = false;
      for (const p of placed) {
        if (Math.abs(p.x - c.sx) < 26 && Math.abs(p.y - c.sy) < 15) { clash = true; break; }
      }
      if (clash) {
        c.it.el.style.display = 'none';
        continue;
      }
      placed.push({ x: c.sx, y: c.sy });
      c.it.el.style.display = 'block';
      c.it.el.style.left = `${c.sx.toFixed(0)}px`;
      c.it.el.style.top = `${c.sy.toFixed(0)}px`;
    }
  }

  function setVisible(on) {
    visible = on;
    layer.style.display = on ? 'block' : 'none';
    if (!on) {
      for (const it of items) it.el.style.display = 'none';
      timer = 0;
    }
  }
  setVisible(false);

  console.log(`[PPT] id tags ready: ${items.length} (${data.yards.length} blocks)`);
  return { element: layer, items, setVisible, update };
}
