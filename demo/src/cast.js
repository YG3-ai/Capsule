// src/cast.js — load + place the PSX characters, each tagged so the editor can grab it.
import * as THREE from 'three';

const FRONT = -Math.PI / 2;   // models face -X by default → -90° turns them toward the camera (+Z)

async function placeChar(capsule, src, id, x, z, ry) {
  const obj = await capsule.loadModel(src).catch((e) => (console.warn('char failed', id, e.message), null));
  if (!obj) return;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const m = o.material;
    if (m && m.map) {   // crisp PSX texels — nearest-neighbour, no mipmaps
      m.map.magFilter = THREE.NearestFilter; m.map.minFilter = THREE.NearestFilter;
      m.map.generateMipmaps = false; m.map.needsUpdate = true;
    }
  });
  // normalize to ~1.8m tall and sit on the floor
  let box = new THREE.Box3().setFromObject(obj);
  obj.scale.setScalar(1.8 / (box.getSize(new THREE.Vector3()).y || 1));
  obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj);
  obj.position.set(x, -box.min.y, z); obj.rotation.y = ry;
  capsule.scene.add(obj);
  capsule.registerEditable(obj, id, 'entity');
}

export async function loadCast(capsule) {
  await Promise.all([
    placeChar(capsule, './assets/models/survivor.glb', 'survivor', 0,    1.5,  FRONT),         // lit, facing us
    placeChar(capsule, './assets/models/doctor.glb',   'doctor',  -3.2, -0.4,  FRONT + 0.5),   // turned, to the side
    placeChar(capsule, './assets/models/killer.glb',   'killer',   3.4, -4.0,  FRONT - 0.7),   // edging in from the right
    placeChar(capsule, './assets/models/monster.glb',  'monster',  1.4, -8.5,  FRONT + 0.15),  // advancing out of the red
  ]);
  capsule.scan();
}
