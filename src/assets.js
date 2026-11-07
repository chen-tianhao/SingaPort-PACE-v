import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';

/**
 * Optional high-detail port assets (PSA crane / RTG / AGV / container ships).
 *
 * Everything is authored in millimetres by the FBX->GLB converter, with Y up
 * and the long axis on X for ships and Z for vehicles.  The helpers below bake
 * the node transforms, convert to metres and (for the quay crane) rotate the
 * boom from +X to our +Z convention.
 */
const BASE = './assets/models/';
const FILES = {
  quayCrane: 'QuayCrane.glb',
  yardCrane: 'YardCrane.glb',
  agv: 'PortAGV_Yellow.glb',
  msc: 'NewMSCContainerVessel.glb',
  cmacgm: 'CMACGMKryptonContainerVessel.glb',
  kota: 'KotaOceanContainerVessel.glb',
  vistula: 'VistulaMaerskContainerVessel.glb',
  pacific: 'PacificSingaporeVessel.glb',
};

function tuneMaterial(m) {
  if (!m) return;
  m.metalness = 0.04;
  m.roughness = 0.86;
  m.side = THREE.FrontSide;
  // lift the asset textures: the PBR maps are dark and the scene has no env map
  m.color.multiplyScalar(1.55);
  if (m.map) {
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveMap = m.map;
    m.emissiveIntensity = 0.22;
  }
  m.needsUpdate = true;
}

/** Bake every mesh into world space, scale to metres and optionally yaw. */
function partsOf(gltf, scale, rotY = 0) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (rotY) g.rotateY(rotY);
    g.scale(scale, scale, scale);
    g.computeBoundingBox();
    // the yard-crane origin sits at mid-height; put every asset's feet on y=0
    g.translate(0, -g.boundingBox.min.y, 0);
    g.computeBoundingSphere();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    tuneMaterial(mat);
    parts.push({ geo: g, mat });
  });
  return parts;
}

function vesselProto(gltf) {
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(tuneMaterial);
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return { root, box };
}

export async function loadPortAssets(onProgress) {
  const loader = new GLTFLoader();
  const load = (f) => new Promise((res, rej) => {
    loader.load(BASE + f, res, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    }, rej);
  });
  const [qc, yc, agv, msc, cmacgm, kota, vistula, pacific] = await Promise.all([
    load(FILES.quayCrane), load(FILES.yardCrane), load(FILES.agv),
    load(FILES.msc), load(FILES.cmacgm), load(FILES.kota),
    load(FILES.vistula), load(FILES.pacific),
  ]);
  console.log('[PPT] port assets loaded');

  return {
    quayCrane: partsOf(qc, 0.0007, Math.PI),
    yardCrane: partsOf(yc, 0.001, Math.PI / 2),
    agv: partsOf(agv, 0.001),
    vessels: {
      msc: vesselProto(msc),
      cmacgm: vesselProto(cmacgm),
      kota: vesselProto(kota),
      vistula: vesselProto(vistula),
      pacific: vesselProto(pacific),
    },
  };
}
