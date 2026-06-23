// === SHARED SCENE MODULE ===
// One source of truth for turning readable scene.json data into three.js meshes.
// Both the game (index.html) and the editor (editor.html) import this, so a prop
// placed in the editor looks identical when the game runs. No build step — plain ESM.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const gltfLoader = new GLTFLoader();

// Load the readable placement data.
export async function loadScene(url = './scene.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return res.json();
}

// Build a single prop mesh from its data entry. Rotation is stored in DEGREES
// (human/LLM readable) and converted to radians here.
export function makeProp(prop) {
  const geo = makeGeometry(prop);
  const mat = new THREE.MeshStandardMaterial({ color: prop.color || '#cccccc' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = prop.id;
  mesh.userData.prop = prop;          // back-reference for the editor
  applyTransform(mesh, prop);
  return mesh;
}

// Load a GLB/GLTF prop. `overrideUrl` lets the editor preview a just-dropped file
// from an object URL before it's been written to assets/ (prop.src is the saved path).
export async function loadModel(prop, overrideUrl) {
  const gltf = await gltfLoader.loadAsync(overrideUrl || prop.src);
  const obj = gltf.scene;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  obj.name = prop.id;
  obj.userData.prop = prop;
  applyTransform(obj, prop);
  return obj;
}

// Unified factory: primitives are sync, models are async. Always returns a Promise.
export async function createProp(prop) {
  if (prop.kind === 'model' && prop.src) return loadModel(prop);
  return makeProp(prop);
}

function makeGeometry({ kind, size = [1, 1, 1] }) {
  switch (kind) {
    case 'box':      return new THREE.BoxGeometry(size[0], size[1], size[2]);
    case 'cylinder': return new THREE.CylinderGeometry(size[0], size[1], size[2], 24);
    case 'sphere':   return new THREE.SphereGeometry(size[0], 24, 16);
    case 'capsule':  return new THREE.CapsuleGeometry(size[0], size[1], 6, 12);
    default:         return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function applyTransform(mesh, prop) {
  const p = prop.position || [0, 0, 0];
  const r = prop.rotation || [0, 0, 0];
  const s = prop.scale    || [1, 1, 1];
  mesh.position.set(p[0], p[1], p[2]);
  mesh.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
  mesh.scale.set(s[0], s[1], s[2]);
}

// Read a mesh's live transform back into the prop's data arrays (radians -> degrees),
// rounded so scene.json stays tidy and diff-friendly.
export function writeTransform(mesh, prop) {
  prop.position = [r3(mesh.position.x), r3(mesh.position.y), r3(mesh.position.z)];
  prop.rotation = [r1(mesh.rotation.x / DEG), r1(mesh.rotation.y / DEG), r1(mesh.rotation.z / DEG)];
  prop.scale    = [r3(mesh.scale.x), r3(mesh.scale.y), r3(mesh.scale.z)];
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;

// Build every prop and add it to the scene. Primitives appear immediately; models
// stream in as they load. Returns a promise of all live meshes.
export async function buildProps(scene, data) {
  const meshes = [];
  const jobs = [];
  for (const prop of data.props || []) {
    if (prop.kind === 'model' && prop.src) {
      jobs.push(loadModel(prop).then((obj) => { scene.add(obj); meshes.push(obj); })
        .catch((err) => console.warn(`model ${prop.id} failed:`, err.message)));
    } else {
      const mesh = makeProp(prop);
      scene.add(mesh);
      meshes.push(mesh);
    }
  }
  await Promise.all(jobs);
  return meshes;
}
