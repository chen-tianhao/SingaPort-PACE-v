import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PAL, mat } from './geo.js';
import { buildTerminal, buildWater } from './terminal.js';
import { buildRegionMap, updateRegionLabels } from './region.js';
import { buildIds } from './ids.js';
import { buildQuayCranes, buildYardCranes, buildTrucks, buildVessels } from './equipment.js';
import { buildYards } from './yards.js';
import { buildChannels, buildBuoys, addFog } from './water.js';

/* =====================================================================
   Collapsible HUD.

   Every [data-panel] folds to its header. On a phone all panels start
   folded so the scene is not buried under chrome; the user's explicit
   choices are remembered per panel id.
   ===================================================================== */
const HUD_KEY = 'ppt.hud.v1';
const HUD_MQ = window.matchMedia('(max-width: 820px)');
const hudStored = (() => {
  try { return JSON.parse(localStorage.getItem(HUD_KEY) || '{}'); } catch { return {}; }
})();
const hudPanels = [...document.querySelectorAll('.panel[data-panel]')];

function setFolded(el, on) {
  el.classList.toggle('collapsed', on);
  el.querySelector('.phead')?.setAttribute('aria-expanded', String(!on));
}

for (const el of hudPanels) {
  const saved = hudStored[el.id];
  setFolded(el, saved === undefined ? HUD_MQ.matches : !!saved);

  const head = el.querySelector('.phead');
  if (!head) continue;
  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');

  const toggle = () => {
    const on = !el.classList.contains('collapsed');
    setFolded(el, on);
    hudStored[el.id] = on;
    try { localStorage.setItem(HUD_KEY, JSON.stringify(hudStored)); } catch { /* private mode */ }
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

// crossing the breakpoint re-applies the device default, but never
// overrides a panel the user has folded or opened by hand
HUD_MQ.addEventListener('change', (e) => {
  for (const el of hudPanels) if (hudStored[el.id] === undefined) setFolded(el, e.matches);
});

/* =====================================================================
   Runtime — the hook layer for future dynamic behaviour.
   Every static object can be registered and later animated without
   touching the builder code. tick(dt) drives all registered entities.
   ===================================================================== */
class Runtime {
  constructor() {
    this.entities = new Map();
    this.time = 0;
    this.listeners = [];
  }
  register(id, object3d, meta = {}) {
    this.entities.set(id, { id, object3d, meta, onTick: null });
    return this.entities.get(id);
  }
  onTick(id, fn) {
    const e = this.entities.get(id);
    if (e) e.onTick = fn;
  }
  onFrame(fn) { this.listeners.push(fn); }
  tick(dt) {
    this.time += dt;
    for (const e of this.entities.values()) if (e.onTick) e.onTick(dt, this.time, e);
    for (const fn of this.listeners) fn(dt, this.time);
  }
}

/* ------------------------------------------------------------------ boot */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8aa7bb);
addFog(scene, 0x93aec0);

// near is kept generous: on a 26 km far plane a 2 m near plane wastes most of
// the depth buffer, which shows up as z-fighting on the flat overlay layers
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 8, 26000);
camera.position.set(250, 1980, 3480);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1300, 0, 420);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 40;
controls.maxDistance = 14000;
controls.screenSpacePanning = false;

/* ------------------------------------------------------------------ sky */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(20000, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2d5170) }, bot: { value: new THREE.Color(0xa8c3d2) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 bot; varying vec3 vP;
      void main(){
        float h = clamp((normalize(vP).y + 0.15) / 0.75, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(h, 0.65));
        c += 0.035 * smoothstep(0.55, 0.0, h);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -2;        // painted before anything else, so distant water never loses to it
sky.frustumCulled = false;
scene.add(sky);

/* ------------------------------------------------------------------ lights */
scene.add(new THREE.HemisphereLight(0xcfe2ef, 0x525a60, 1.35));
const sun = new THREE.DirectionalLight(0xfff4e2, 3.0);
sun.position.set(2400, 3200, -1800);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9dc4dc, 0.6);
rim.position.set(-2000, 900, 2600);
scene.add(rim);

/* ------------------------------------------------------------------ data + build */
const loadBar = document.getElementById('bar');
const data = await fetch('./data/ppt_terminal.json').then((r) => r.json());
loadBar.style.width = '18%';

const runtime = new Runtime();
const layers = {};
const root = new THREE.Group();
scene.add(root);

const terminalGroup = new THREE.Group();
const yardGroup = new THREE.Group();
const craneGroup = new THREE.Group();
const yardCraneGroup = new THREE.Group();
const vesselGroup = new THREE.Group();
const truckGroup = new THREE.Group();
root.add(terminalGroup, yardGroup, craneGroup, yardCraneGroup, vesselGroup, truckGroup);

const t = performance.now();

const { labels, zones } = buildTerminal(data, terminalGroup);
loadBar.style.width = '28%';

/* the regional map is decorative: its absence must never break the scene */
const region = await fetch('./data/region_coast.json')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
layers.region = region ? buildRegionMap(region, terminalGroup) : null;
loadBar.style.width = '34%';

/* satellite base layer: real Google imagery in the model frame.  Toggling it
   on hides the model's ground/roads and lets the yard be compared 1:1. */
const satelliteGroup = new THREE.Group();
satelliteGroup.name = 'satellite';
satelliteGroup.visible = false;
terminalGroup.add(satelliteGroup);
layers.satellite = satelliteGroup;
(async () => {
  try {
    const [tex, meta] = await Promise.all([
      new THREE.TextureLoader().loadAsync('./data/ppt_satellite.jpg'),
      fetch('./data/ppt_satellite.json').then((r) => r.json()),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const g = new THREE.PlaneGeometry(meta.x1 - meta.x0, meta.z1 - meta.z0);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((meta.x0 + meta.x1) / 2, 5.5, (meta.z0 + meta.z1) / 2);
    mesh.name = 'satellite_plane';
    satelliteGroup.add(mesh);
  } catch (e) {
    console.warn('[PPT] satellite layer unavailable', e);
  }
})();

const water = buildWater(data, terminalGroup);
layers.channels = buildChannels(data, root);
buildBuoys(data, layers.channels);
loadBar.style.width = '46%';

const yards = buildYards(data, yardGroup);
loadBar.style.width = '68%';

const nQC = buildQuayCranes(data, craneGroup);
const nYC = buildYardCranes(data, yardCraneGroup);
const nTruck = buildTrucks(data, truckGroup);
loadBar.style.width = '86%';

const vessels = buildVessels(data, vesselGroup);
loadBar.style.width = '96%';

/* ------------------------------------------------------------------ entity registry */
layers.labels = labels;
layers.zones = zones;
layers.cranes = craneGroup;
layers.yardcranes = yardCraneGroup;
layers.containers = yardGroup;
layers.vessels = vesselGroup;
layers.vehicles = truckGroup;

runtime.register('yard', yardGroup, { blocks: yards.blocks.length });
runtime.register('cranes', craneGroup, { count: nQC });
for (const v of vessels) {
  const obj = vesselGroup.children.find((c) => c.name === 'vessel_' + v.id);
  if (obj) runtime.register('vessel_' + v.id, obj, v);
}
// example hook: ships idle on a 12 s bob — disabled by default, kept as a template
runtime.onTick('vessel_V1', null);

/* ------------------------------------------------------------------ HUD */
document.getElementById('k-berth').textContent = data.meta.berths;
// HUD: the quay KPI shows the modelled frontage (the full chain), while the
// published berth-box total is a different figure and is reported separately
document.getElementById('k-quay').innerHTML = data.meta.quay_chain_m.toLocaleString('en').replace(/,/g, ' ') + '<span>m</span>';
document.getElementById('k-qc').textContent = data.meta.quay_cranes;
// HUD shows what the scene actually contains; the published fleet total
// (data.equipment.yard_cranes.total) is a different, unconfirmed figure
// and is no longer displayed here.
document.getElementById('k-yard').textContent = nYC;
document.getElementById('k-teu').textContent = yards.total.toLocaleString('en').replace(/,/g, ' ');

const termList = document.getElementById('term-list');
if (termList && data.terminals) {
  termList.innerHTML = data.terminals.map((t) => `
    <div class="trow">
      <i style="background:${t.color}"></i><b>${t.id}</b>
      <span>${t.berth_range}</span><em>${t.n}p · ${t.quay} m</em>
    </div>`).join('');
}

const perfFps = document.getElementById('fps');
const perfDc = document.getElementById('dc');
const perfTri = document.getElementById('tri');
const lodEl = document.getElementById('lod');

/* ------------------------------------------------------------------ views */
const _b = data.berths.find((b) => b.id === 'B17') || data.berths[0];
const _vb = document.getElementById('vb');
if (_vb) _vb.textContent = _b.id;
const _n = _b.normal;

/* the seaward view frames the first berth that actually has a ship on it */
const _bv = (data.vessels && data.vessels.length
  ? data.berths.find((b) => b.id === data.vessels[0].berth)
  : null) || _b;

/* frame the terminal automatically from the real footprint */
const _bb = data.land.reduce(
  (a, p) => ({
    x0: Math.min(a.x0, p[0]), x1: Math.max(a.x1, p[0]),
    z0: Math.min(a.z0, p[1]), z1: Math.max(a.z1, p[1]),
  }),
  { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 },
);
const _cx = (_bb.x0 + _bb.x1) / 2;
const _cz = (_bb.z0 + _bb.z1) / 2;
const _span = Math.max(_bb.x1 - _bb.x0, _bb.z1 - _bb.z0);

const VIEWS = {
  overview: { pos: [_cx - _span * 0.15, _span * 1.35, _cz + _span * 0.55], tgt: [_cx - _span * 0.10, 0, _cz] },
  berth:    { pos: [_b.mid[0] + _n[0] * 520, 165, _b.mid[1] + _n[1] * 520], tgt: [_b.mid[0] + _n[0] * 70, 38, _b.mid[1] + _n[1] * 70] },
  yard:     { pos: [_b.mid[0] - _n[0] * 520, 230, _b.mid[1] - _n[1] * 520], tgt: [_b.mid[0] - _n[0] * 170, 12, _b.mid[1] - _n[1] * 170] },
  gate:     { pos: [data.gate.x - 210, 60, data.gate.z + 170], tgt: [data.gate.x, 6, data.gate.z - 40] },
  sea:      { pos: [_bv.mid[0] + _bv.normal[0] * 980, 340, _bv.mid[1] + _bv.normal[1] * 980],
              tgt: [_bv.mid[0] + _bv.normal[0] * 140, 26, _bv.mid[1] + _bv.normal[1] * 140] },
  crane:    { pos: [_b.mid[0] + _n[0] * 165, 52, _b.mid[1] + _n[1] * 165], tgt: [_b.mid[0], 58, _b.mid[1]] },
};
let flight = null;
function goView(name) {
  const v = VIEWS[name];
  if (!v) return;
  const k = frameFactor();
  const t1 = new THREE.Vector3(...v.tgt);
  const p1 = new THREE.Vector3(...v.pos).sub(t1).multiplyScalar(k).add(t1);
  flight = {
    t: 0,
    p0: camera.position.clone(), p1,
    t0: controls.target.clone(), t1,
  };
  document.querySelectorAll('#views button').forEach((b) =>
    b.classList.toggle('act', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach((b) =>
  b.addEventListener('click', () => goView(b.dataset.view)));

/* ------------------------------------------------------------------ layers */
const LAYER_LABEL = {
  cranes: '岸桥 Quay Cranes', yardcranes: '场桥 Yard Cranes', containers: '集装箱 Containers',
  vessels: '船舶 Vessels', channels: '航道 Channels', labels: '标注 Labels', vehicles: '集卡 Trucks',
  zones: '泊位分区 Berth Zones', satellite: '卫星底图 Satellite', ids: '编号 IDs',
};
let idLayer = null;
document.querySelectorAll('.sw').forEach((el) => {
  el.addEventListener('click', () => {
    const k = el.dataset.layer;
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    if (k === 'ids') {
      if (!idLayer) {
        idLayer = buildIds(data, { cranes: craneGroup, yardcranes: yardCraneGroup, trucks: truckGroup });
      }
      idLayer.setVisible(on);
      return;
    }
    const target = layers[k];
    if (target) target.visible = on;
    if (k === 'channels') {
      // channel group lives on the root; toggle its children
      root.children.filter((c) => c === target).forEach((c) => (c.visible = on));
    }
  });
});

/* ------------------------------------------------------------------ resize */
/* A portrait phone keeps the vertical FOV and loses most of the site, so
   widen the vertical FOV to hold a usable horizontal field of view. */
const BASE_FOV = 48;
const BASE_ASPECT = 16 / 9;
const MAX_FOV = 72;

function fitView() {
  const aspect = window.innerWidth / window.innerHeight;
  let fov = BASE_FOV;
  if (aspect < BASE_ASPECT) {
    const halfH = Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * BASE_ASPECT);
    fov = (2 * Math.atan(Math.tan(halfH) / aspect) * 180) / Math.PI;
  }
  camera.fov = Math.min(fov, MAX_FOV);     // cap to avoid barrel-like distortion
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* How much further back the camera has to sit to hold the same horizontal
   coverage. 1 on a widescreen, ~2 on a tall phone. */
function frameFactor() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= BASE_ASPECT) return 1;
  const tanHalfH = Math.tan((camera.fov * Math.PI) / 360) * aspect;
  const tanBaseH = Math.tan((BASE_FOV * Math.PI) / 360) * BASE_ASPECT;
  return Math.min(tanBaseH / tanHalfH, 1.9);
}

fitView();
const _bootK = frameFactor();
if (_bootK > 1) {
  camera.position.sub(controls.target).multiplyScalar(_bootK).add(controls.target);
  controls.update();
}
window.addEventListener('resize', fitView);

/* ------------------------------------------------------------------ loop */
const clock = new THREE.Clock();
let acc = 0, frames = 0, lodTimer = 0;
const lastCam = new THREE.Vector3(1e9, 0, 0);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (flight) {
    flight.t = Math.min(1, flight.t + dt / 1.25);
    const e = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - Math.pow(-2 * flight.t + 2, 2) / 2;
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (flight.t >= 1) flight = null;
  }

  controls.update();
  sky.position.copy(camera.position);   // keep the gradient centred on the viewer
  if (layers.region) updateRegionLabels(layers.region, camera);

  // LOD refresh — throttled, and only when the camera actually moved
  lodTimer += dt;
  if (lodTimer > 0.22 && camera.position.distanceToSquared(lastCam) > 900) {
    lodTimer = 0;
    lastCam.copy(camera.position);
    yards.update(camera.position);
    let l0 = 0, l1 = 0, l2 = 0;
    for (const b of yards.blocks) {
      if (b.level === 0) l0++; else if (b.level === 1) l1++; else l2++;
    }
    lodEl.textContent = `LOD ${l0} / ${l1} / ${l2}`;
  }

  water.uniforms.uTime.value += dt;
  runtime.tick(dt);
  if (idLayer) idLayer.update(camera.position, camera, dt);
  renderer.render(scene, camera);

  frames++; acc += dt;
  if (acc >= 0.5) {
    perfFps.textContent = Math.round(frames / acc);
    perfDc.textContent = renderer.info.render.calls;
    perfTri.textContent = (renderer.info.render.triangles / 1000).toFixed(0) + 'k';
    frames = 0; acc = 0;
  }
}

animate();

/* ------------------------------------------------------------------ ready */
renderer.compile(scene, camera);
setTimeout(() => {
  const load = document.getElementById('load');
  load.classList.add('hide');
  // drop it from the DOM once the fade is over, so it cannot tint a screenshot
  setTimeout(() => load.remove(), 900);
}, 180);
console.log(`[PPT] built in ${(performance.now() - t).toFixed(0)} ms · ` +
  `${nQC} quay cranes · ${nYC} yard cranes · ${yards.total} containers · ${nTruck} trucks`);

/* public handle for the future dynamic layer */
window.PPT = {
  scene, camera, controls, renderer, data, runtime, yards, layers, goView,
  pickable: { yardGroup, craneGroup, vesselGroup },
};

/* deep link: ?view=yard|gate|crane|berth|sea|overview */
const _qv = new URLSearchParams(location.search).get('view');
if (_qv) setTimeout(() => {
  const v = VIEWS[_qv];
  if (v) {
    camera.position.set(...v.pos);
    controls.target.set(...v.tgt);
    controls.update();
  }
  document.querySelectorAll('#views button').forEach((b) =>
    b.classList.toggle('act', b.dataset.view === _qv));
}, 2200);
/* debug camera: ?cam=x,y,z,tx,ty,tz */
const _cam = new URLSearchParams(location.search).get('cam');
if (_cam) {
  const [px, py, pz, tx, ty, tz] = _cam.split(',').map(Number);
  setTimeout(() => {
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    controls.update();
  }, 2300);
}
