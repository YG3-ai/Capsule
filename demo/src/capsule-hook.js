// src/capsule-hook.js — the Capsule editor/AI runtime.
//
// Sets up window.capsule so the editor overlay (and the AI over MCP) can see, tag,
// and place objects. Scenes are independent: each object remembers which scene it
// belongs to, so switching scenes shows only that scene's objects. Keep this module —
// it's infrastructure, not game logic. Build your game in the other src/ files.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const _loader = new GLTFLoader();

export function initCapsuleHook({ scene, camera, renderer }) {
  const _apply = (obj, o) => {
    if (!o) return;
    if (o.position) obj.position.set(o.position[0], o.position[1], o.position[2]);
    if (o.rotation) obj.rotation.set(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG);
    if (o.scale)    obj.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    if (o.visible !== undefined) obj.visible = o.visible;
  };
  const _inScene = (o) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };

  const capsule = {
    scene, camera, renderer, THREE,
    data: { version: 1, scenes: {} }, editable: [], detectors: [], scenes: {},
    activeScene: 'main', activeState: 'base',
    _resolve(id) { const sc = this.data.scenes?.[this.activeScene]; if (!sc) return null;
      return { ...(sc.base?.[id] || {}), ...(sc.states?.[this.activeState]?.[id] || {}) }; },
    registerEditable(obj, id, type) {
      obj.userData.capsuleId = id; if (type) obj.userData.capsuleType = type; if (!obj.name) obj.name = id;
      if (obj.userData.capsuleScene === undefined) obj.userData.capsuleScene = this.activeScene;
      this.editable = this.editable.filter(e => e.id !== id);
      this.editable.push({ id, obj, type: obj.userData.capsuleType || 'object' });
      _apply(obj, this._resolve(id)); return obj;
    },
    tag(obj, opts = {}) { const o = typeof opts === 'string' ? { type: opts } : opts;
      const id = o.id || `${o.type || 'obj'}@${Math.round(obj.position.x * 10) / 10},${Math.round(obj.position.z * 10) / 10}`;
      return this.registerEditable(obj, id, o.type); },
    addDetector(fn) { this.detectors.push(fn); return this; },
    scan() { this.scene.traverse(o => {
        if (this.editable.some(e => e.obj === o)) return;
        let id = o.userData?.capsuleId;
        if (!id) for (const d of this.detectors) { const r = d(o); if (r?.id) { id = r.id; o.userData.capsuleId = id; if (r.type) o.userData.capsuleType = r.type; break; } }
        if (!id) return;
        if (o.userData.capsuleScene === undefined) o.userData.capsuleScene = this.activeScene;
        if (o.userData.capsuleScene === this.activeScene) this.registerEditable(o, id, o.userData.capsuleType);
      });
      this.editable = this.editable.filter(e => _inScene(e.obj) && e.obj.userData.capsuleScene === this.activeScene); },
    defineScene(name, def) { this.scenes[name] = def; },
    setActiveScene(name) {
      if (this.activeScene === name) return;
      this.activeScene = name;
      this.scene.traverse(o => { const s = o.userData && o.userData.capsuleScene; if (s !== undefined) o.visible = (s === name); });
      this.editable = [];
      this._loadAdded();
      this.scan();
    },
    setActiveState(state) { if (this.activeState === state) return; this.activeState = state;
      for (const { id, obj } of this.editable) _apply(obj, this._resolve(id)); },
    loadModel(src) { return new Promise((res, rej) => _loader.load(src, g => res(g.scene), undefined, rej)); },
    _prim(geo, color) {
      const s = geo.shape, c = color ? new THREE.Color(color).getHex() : 0x9aa0aa;
      const g = s === 'sphere' ? new THREE.SphereGeometry(0.6, 24, 16)
        : s === 'cylinder' ? new THREE.CylinderGeometry(0.4, 0.4, 2.5, 20) : new THREE.BoxGeometry(1, 1, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, emissive: c, emissiveIntensity: 0.3 }));
      m.castShadow = true; m.receiveShadow = true; return m;
    },
    _added: new Set(),
    async addObject(prop) {
      const obj = await this.loadModel(prop.src);
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      obj.userData.capsuleAdded = true; _apply(obj, prop); this.scene.add(obj); this._added.add(prop.id);
      this.registerEditable(obj, prop.id, prop.type || 'model');
      const sc = this.data.scenes[this.activeScene] || (this.data.scenes[this.activeScene] = { base: {}, states: {}, added: [] });
      if (!sc.added) sc.added = [];
      if (!sc.added.find(a => a.id === prop.id)) sc.added.push(prop);
      return obj;
    },
    _loadAdded() {
      const sc = this.data.scenes?.[this.activeScene]; if (!sc?.added) return;
      for (const a of sc.added) {
        if (this._added.has(a.id)) continue; this._added.add(a.id);
        if (a.geo) { const m = this._prim(a.geo, a.color); m.userData.capsuleAdded = true; _apply(m, a);
          this.scene.add(m); this.registerEditable(m, a.id, a.type || 'prop'); continue; }
        this.loadModel(a.src).then(obj => { obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          obj.userData.capsuleAdded = true; _apply(obj, a); this.scene.add(obj); this.registerEditable(obj, a.id, a.type || 'model');
        }).catch(e => console.warn('[capsule] added object failed:', a.id, e.message)); }
    },
  };

  window.capsule = capsule;
  fetch('./capsule.scenes.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
    .then(d => { if (d) capsule.data = d; capsule.scan(); capsule._loadAdded(); }).catch(() => {});
  setInterval(() => capsule.scan(), 1500);
  return capsule;
}
