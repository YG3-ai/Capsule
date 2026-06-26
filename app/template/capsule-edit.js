// Capsule live-attach editor overlay.
//
// Drives the host game's existing scene / camera / renderer (window.capsule).
// You pick a Scene + Layer, orbit, drag the game's hand-placed entities, and Save —
// writing layered placement data to capsule.scenes.json (see SCENES.md): editing the
// Base layer writes the scene's base; editing a State layer writes only the delta vs
// base. The game applies base ⊕ active-state on load, so the normal game reflects edits.

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const DEG = Math.PI / 180;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
const xform = (o) => ({
  position: [r3(o.position.x), r3(o.position.y), r3(o.position.z)],
  rotation: [r1(o.rotation.x / DEG), r1(o.rotation.y / DEG), r1(o.rotation.z / DEG)],
  scale: [r3(o.scale.x), r3(o.scale.y), r3(o.scale.z)],
});
const sameVec = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function initCapsuleEditor(capsule) {
  const { scene, camera, renderer, THREE } = capsule;

  // The editor owns activeState while open (stops animate auto-syncing it).
  capsule.editLock = true;
  let editScene = capsule.activeScene || Object.keys(capsule.scenes)[0] || 'scene';
  let editLayer = 'base';          // 'base' or a state name (e.g. 'loop3')
  let selected = null;
  let dirty = false;
  let fileHandle = null;

  // ── undo / redo ───────────────────────────────────────
  const undoStack = [], redoStack = [];
  const snap = (o) => ({ p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() });
  const applySnap = (o, s) => { o.position.copy(s.p); o.rotation.copy(s.r); o.scale.copy(s.s); };
  function pushUndo(obj, before, after) {
    if (before.p.equals(after.p) && before.r.equals(after.r) && before.s.equals(after.s)) return;
    undoStack.push({ obj, before, after });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    const e = undoStack.pop(); if (!e) return flash('nothing to undo');
    applySnap(e.obj, e.before); redoStack.push(e);
    if (selected !== e.obj) select(e.obj); else { gizmo.attach(e.obj); writeSelected(); }
    markDirty(); flash('undo');
  }
  function redo() {
    const e = redoStack.pop(); if (!e) return flash('nothing to redo');
    applySnap(e.obj, e.after); undoStack.push(e);
    if (selected !== e.obj) select(e.obj); else { gizmo.attach(e.obj); writeSelected(); }
    markDirty(); flash('redo');
  }

  // ── orbit camera ──────────────────────────────────────
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = false;
  orbit.target.set(camera.position.x, 1, camera.position.z - 10);
  orbit.update();

  function frameObject(obj) {
    const c = new THREE.Vector3();
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) obj.getWorldPosition(c); else box.getCenter(c);
    orbit.target.copy(c);
    camera.position.set(c.x + 4, c.y + 2, c.z + 4);
    camera.lookAt(c);
    orbit.update();
  }

  // ── gizmo ─────────────────────────────────────────────
  const gizmo = new TransformControls(camera, renderer.domElement);
  let dragBefore = null;
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value) dragBefore = selected ? snap(selected) : null;
    else if (dragBefore && selected) { pushUndo(selected, dragBefore, snap(selected)); dragBefore = null; }
  });
  gizmo.addEventListener('objectChange', () => { writeSelected(); markDirty(); });
  const gizmoHelper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  scene.add(gizmoHelper);

  // Find objects that look like placeable assets but carry no capsuleId and match
  // no detector — so coverage gaps are visible instead of guessed. Heuristic:
  // top-level scene children that contain meshes and aren't structure/lights/merged.
  function findUntagged() {
    const tracked = new Set(capsule.editable.map((e) => e.obj));
    const out = [];
    for (const o of scene.children) {
      if (o.isLight || o.isCamera || o === gizmoHelper || tracked.has(o)) continue;
      const ud = o.userData || {};
      if (ud.capsuleId || ud.merged) continue;
      // Assets are loaded models — Groups that contain meshes. Bare procedural
      // meshes (cbox walls/floor/panels) are structure, not assets: skip them.
      if (o.isMesh || !(o.isGroup || o.type === 'Group' || o.type === 'Object3D')) continue;
      if (/transformcontrols/i.test(o.type) || (o.constructor && /Transform/.test(o.constructor.name))) continue;
      if (/sky|ground|floor|ceiling|wall|grid|helper|fog|merged|corridor/i.test(o.name || '')) continue;
      let meshes = 0;
      o.traverse((c) => { if (c.isMesh) meshes++; });
      if (meshes === 0) continue;
      out.push(o);
    }
    return out;
  }
  function suggestTag(obj) {
    const nm = (obj.name || 'asset').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 24);
    return `capsule.tag(obj, { type: 'prop', id: '${nm || 'asset'}@${r3(obj.position.x)},${r3(obj.position.z)}' })`;
  }
  const isTracked = (obj) => capsule.editable.some((e) => e.obj === obj);

  // ── UI ────────────────────────────────────────────────
  const ui = injectUI();
  const { hud, list, saveBtn, modeBtns, sceneSel, layerSel, undoBtn, redoBtn, playBtn, homeBtn, codeBtn, inspEl, inspInputs } = ui;
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  // Play = run the real game (drop ?edit). Saved placements still apply on load.
  playBtn.onclick = () => { const u = new URL(location.href); u.searchParams.delete('edit'); location.href = u.toString(); };
  // Home / VS Code need the Capsule app bridge; hide them in a plain browser.
  const host = window.capsuleHost;
  if (host && host.welcome) homeBtn.onclick = () => host.welcome(); else homeBtn.style.display = 'none';
  if (host && host.openInVSCode) codeBtn.onclick = () => host.openInVSCode(); else codeBtn.style.display = 'none';

  // ── numeric inspector (type exact transforms) ─────────
  function refreshInspector() {
    const on = selected && isTracked(selected);
    inspEl.style.display = on ? 'block' : 'none';
    if (!on) return;
    const t = xform(selected);
    inspInputs.px.value = t.position[0]; inspInputs.py.value = t.position[1]; inspInputs.pz.value = t.position[2];
    inspInputs.rx.value = t.rotation[0]; inspInputs.ry.value = t.rotation[1]; inspInputs.rz.value = t.rotation[2];
    inspInputs.sx.value = t.scale[0];    inspInputs.sy.value = t.scale[1];    inspInputs.sz.value = t.scale[2];
  }
  function applyInspector() {
    if (!selected || !isTracked(selected)) return;
    const num = (k, fallback) => { const v = parseFloat(inspInputs[k].value); return Number.isFinite(v) ? v : fallback; };
    const before = snap(selected);
    selected.position.set(num('px', selected.position.x), num('py', selected.position.y), num('pz', selected.position.z));
    selected.rotation.set(num('rx', selected.rotation.x / DEG) * DEG, num('ry', selected.rotation.y / DEG) * DEG, num('rz', selected.rotation.z / DEG) * DEG);
    selected.scale.set(num('sx', selected.scale.x), num('sy', selected.scale.y), num('sz', selected.scale.z));
    pushUndo(selected, before, snap(selected));
    markDirty(); writeSelected();
  }
  for (const k in inspInputs) inspInputs[k].addEventListener('change', applyInspector);

  function layersFor(sceneName) {
    const states = (capsule.scenes[sceneName] && capsule.scenes[sceneName].states) || [];
    return ['base', ...states];   // Base (shared) + every real state/loop
  }
  function labelFor(layer) {
    if (layer === 'base') return 'Base · all states';
    const labels = (capsule.scenes[editScene] && capsule.scenes[editScene].labels) || {};
    return labels[layer] || layer;
  }
  function populateScenePickers() {
    sceneSel.innerHTML = '';
    for (const name of Object.keys(capsule.scenes)) {
      const o = document.createElement('option'); o.value = name; o.textContent = name; sceneSel.appendChild(o);
    }
    sceneSel.value = editScene;
    populateLayerPicker();
  }
  function populateLayerPicker() {
    layerSel.innerHTML = '';
    for (const l of layersFor(editScene)) {
      const o = document.createElement('option'); o.value = l; o.textContent = labelFor(l); layerSel.appendChild(o);
    }
    layerSel.value = editLayer;
  }
  sceneSel.onchange = () => {
    editScene = sceneSel.value;
    const sc = capsule.scenes[editScene];
    if (sc && sc.setState) sc.setState((sc.states && sc.states[0]) || 'base');  // drive game to the scene
    editLayer = 'base';
    populateLayerPicker();
    previewLayer();
  };
  layerSel.onchange = () => { editLayer = layerSel.value; previewLayer(); };

  // Preview a layer by driving the game to that loop (so the real degradation /
  // blackout / chase state is visible) AND re-applying the placement deltas on top.
  // 'base' shows the clean loop-0 view; edits there apply to every loop.
  function previewLayer() {
    const sc = capsule.scenes[editScene];
    if (editLayer === 'base') {
      if (sc && sc.setState) sc.setState((sc.states && sc.states[0]) || 'loop0');
      capsule.setActiveState('base');
    } else {
      if (sc && sc.setState) sc.setState(editLayer);   // drive the game to this loop
      capsule.setActiveState(editLayer);               // layer the saved deltas on top
    }
    select(null);
    refreshList();
    writeSelected();
  }

  function setMode(m) { gizmo.setMode(m); for (const k in modeBtns) modeBtns[k].classList.toggle('on', k === m); }
  modeBtns.translate.onclick = () => setMode('translate');
  modeBtns.rotate.onclick = () => setMode('rotate');
  modeBtns.scale.onclick = () => setMode('scale');
  saveBtn.onclick = save;

  // ── selection ─────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved > 4 || gizmo.dragging) return;
    ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
    ptr.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const objs = capsule.editable.map((e) => e.obj);
    const hit = ray.intersectObjects(objs, true)[0];
    let o = hit ? hit.object : null;
    while (o && !objs.includes(o)) o = o.parent;
    select(o || null);
  });

  function select(obj, frame = false) {
    selected = obj;
    if (obj) { gizmo.attach(obj); if (frame) frameObject(obj); } else gizmo.detach();
    refreshList();
    writeSelected();
  }
  function idOf(obj) { const e = capsule.editable.find((e) => e.obj === obj); return e ? e.id : '(?)'; }

  function writeSelected() {
    refreshInspector();
    const tag = `scene: ${editScene}   layer: ${editLayer}`;
    if (!selected) { hud.textContent = `${tag}\n${capsule.editable.length} editable · click one`; return; }
    if (!isTracked(selected)) {
      hud.textContent = `⚠ UNTAGGED · ${selected.name || '(unnamed)'}\n` +
        `not editable yet — tag it at its spawn site:\n${suggestTag(selected)}`;
      return;
    }
    hud.textContent = `${tag}\n${idOf(selected)}  ·  ${(capsule.editable.find((e) => e.obj === selected) || {}).type || 'object'}`;
  }

  // ── object list ───────────────────────────────────────
  let lastCount = -1;
  function refreshList() {
    list.innerHTML = '';
    const groups = {};
    for (const e of capsule.editable) (groups[e.type || 'object'] || (groups[e.type || 'object'] = [])).push(e);
    for (const type of Object.keys(groups).sort()) {
      const h = document.createElement('div');
      h.className = 'cap-cat';
      h.textContent = `${type} (${groups[type].length})`;
      list.appendChild(h);
      for (const { id, obj } of groups[type]) {
        const div = document.createElement('div');
        div.className = 'cap-item' + (obj === selected ? ' sel' : '');
        div.textContent = id;
        div.onclick = () => select(obj, true);
        list.appendChild(div);
      }
    }
    // Coverage gaps: assets that aren't tagged/detected yet.
    const untagged = findUntagged();
    if (untagged.length) {
      const h = document.createElement('div');
      h.className = 'cap-cat cap-warn';
      h.textContent = `⚠ untagged (${untagged.length})`;
      list.appendChild(h);
      for (const obj of untagged) {
        const div = document.createElement('div');
        div.className = 'cap-item cap-untagged' + (obj === selected ? ' sel' : '');
        const p = obj.position;
        div.textContent = `${obj.name || 'asset'} @${r3(p.x)},${r3(p.z)}`;
        div.onclick = () => select(obj, true);
        list.appendChild(div);
      }
    }
    lastCount = capsule.editable.length;
  }
  const poll = setInterval(() => {
    if (capsule.editable.length !== lastCount) { refreshList(); if (!selected) writeSelected(); }
  }, 600);
  setTimeout(() => clearInterval(poll), 15000);

  // ── save → capsule.scenes.json (layered) ──────────────
  function ensureScene() {
    if (!capsule.data.scenes) capsule.data.scenes = {};
    if (!capsule.data.scenes[editScene]) capsule.data.scenes[editScene] = { base: {}, states: {} };
    const sc = capsule.data.scenes[editScene];
    if (!sc.base) sc.base = {};
    if (!sc.states) sc.states = {};
    return sc;
  }
  function buildLayer() {
    const sc = ensureScene();
    if (editLayer === 'base') {
      // Base = full transform of every editable.
      for (const { id, obj } of capsule.editable) sc.base[id] = xform(obj);
    } else {
      // State = delta: only fields that differ from base.
      const delta = {};
      for (const { id, obj } of capsule.editable) {
        const cur = xform(obj);
        const base = sc.base[id] || {};
        const d = {};
        if (!sameVec(cur.position, base.position)) d.position = cur.position;
        if (!sameVec(cur.rotation, base.rotation)) d.rotation = cur.rotation;
        if (!sameVec(cur.scale, base.scale)) d.scale = cur.scale;
        if (Object.keys(d).length) delta[id] = d;
      }
      sc.states[editLayer] = delta;
    }
    if (!capsule.data.version) capsule.data.version = 1;
  }

  async function save() {
    buildLayer();
    const json = JSON.stringify(capsule.data, null, 2) + '\n';
    // Capsule desktop app: the project folder is already known — write straight
    // to disk, no picker. (Presence of window.capsuleHost means we're in the app.)
    if (window.capsuleHost && window.capsuleHost.saveScenes) {
      const r = await window.capsuleHost.saveScenes(json);
      if (r && r.ok) { dirty = false; saveBtn.classList.remove('dirty'); flash(`saved ${editScene}/${editLayer} → ${String(r.path).split(/[\\/]/).pop()}`); }
      else flash('save failed: ' + ((r && r.error) || 'unknown'));
      return;
    }
    try {
      if (window.showSaveFilePicker) {
        if (!fileHandle) {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: 'capsule.scenes.json',
            types: [{ description: 'Capsule scenes', accept: { 'application/json': ['.json'] } }],
          });
        }
        const w = await fileHandle.createWritable(); await w.write(json); await w.close();
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'capsule.scenes.json'; a.click(); URL.revokeObjectURL(a.href);
      }
      dirty = false; saveBtn.classList.remove('dirty');
      flash(`saved ${editScene}/${editLayer} → capsule.scenes.json`);
    } catch (err) {
      if (err.name !== 'AbortError') flash('save failed: ' + err.message);
    }
  }
  function markDirty() { dirty = true; saveBtn.classList.add('dirty'); }
  function flash(msg) { hud.textContent = msg; setTimeout(() => { if (hud.textContent === msg) writeSelected(); }, 1800); }

  // ── keyboard ──────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
    else if (e.key === 'w' || e.key === 'W') setMode('translate');
    else if (e.key === 'e' || e.key === 'E') setMode('rotate');
    else if (e.key === 'r' || e.key === 'R') setMode('scale');
    else if (e.key === 'Escape') select(null);
    else if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
  }, true);

  // ── API used by the MCP server (drive the editor from Claude) ─
  function byId(id) { const e = capsule.editable.find((e) => e.id === id); return e ? e.obj : null; }
  function listEditables() {
    return capsule.editable.map((e) => ({
      id: e.id, type: e.type,
      position: [r3(e.obj.position.x), r3(e.obj.position.y), r3(e.obj.position.z)],
      rotation: [r1(e.obj.rotation.x / DEG), r1(e.obj.rotation.y / DEG), r1(e.obj.rotation.z / DEG)],
      scale: [r3(e.obj.scale.x), r3(e.obj.scale.y), r3(e.obj.scale.z)],
    }));
  }
  function setTransform(id, t) {
    const obj = byId(id); if (!obj || !t) return false;
    const before = snap(obj);
    if (t.position) obj.position.set(t.position[0], t.position[1], t.position[2]);
    if (t.rotation) obj.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG);
    if (t.scale) obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    pushUndo(obj, before, snap(obj));
    markDirty(); if (selected === obj) writeSelected();
    return true;
  }

  // ── GLB drag-drop import ──────────────────────────────
  const dropHint = document.createElement('div');
  dropHint.style.cssText = 'position:fixed;inset:0;z-index:99998;display:none;align-items:center;justify-content:center;' +
    'pointer-events:none;background:rgba(212,160,74,.10);border:3px dashed #D4A04A;color:#D4A04A;' +
    "font:600 18px 'Satoshi','Inter',system-ui,sans-serif;letter-spacing:.04em";
  dropHint.textContent = 'drop a .glb / .gltf to add it';
  document.body.appendChild(dropHint);
  addEventListener('dragover', (e) => { e.preventDefault(); dropHint.style.display = 'flex'; });
  addEventListener('dragleave', (e) => { if (e.target === document.documentElement) dropHint.style.display = 'none'; });
  addEventListener('drop', async (e) => {
    e.preventDefault();
    dropHint.style.display = 'none';
    const file = [...((e.dataTransfer && e.dataTransfer.files) || [])].find((f) => /\.(glb|gltf)$/i.test(f.name));
    if (!file) { flash('drop a .glb or .gltf file'); return; }
    if (!window.capsuleHost || !window.capsuleHost.saveAsset) { flash('asset import needs the Capsule app'); return; }
    flash('importing ' + file.name + '…');
    const r = await window.capsuleHost.saveAsset(file.name, await file.arrayBuffer());
    if (!r || !r.ok) { flash('save failed: ' + ((r && r.error) || '?')); return; }
    const base = file.name.replace(/\.(glb|gltf)$/i, '').toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'model';
    const id = base + '-' + Math.random().toString(36).slice(2, 6);
    const front = new THREE.Vector3(); camera.getWorldDirection(front); front.y = 0;
    if (front.lengthSq() < 1e-6) front.set(0, 0, -1);
    front.normalize();
    const tgt = orbit.target.clone().add(front.multiplyScalar(3));
    const prop = { id, src: './' + r.path, type: 'model', position: [r3(tgt.x), 0, r3(tgt.z)], rotation: [0, 0, 0], scale: [1, 1, 1] };
    try {
      const obj = await capsule.addObject(prop);
      // sane size + sit on the floor
      let box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = maxDim > 3 ? 2.5 / maxDim : (maxDim < 0.3 ? 1 / maxDim : 1);
      obj.scale.setScalar(s); obj.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(obj);
      obj.position.y = r3(-box.min.y);
      prop.scale = [r3(s), r3(s), r3(s)];
      prop.position = [r3(obj.position.x), r3(obj.position.y), r3(obj.position.z)];
      refreshList(); select(obj, true); markDirty();
      flash('added ' + file.name + ' → assets/models/');
    } catch (err) { flash('load failed: ' + err.message); }
  });

  setMode('translate');
  populateScenePickers();
  refreshList();          // populate the panel immediately on attach
  writeSelected();
  capsule.editor = { select, frameObject, setMode, save, previewLayer, buildLayer, undo, redo, applyInspector,
    byId, list: listEditables, setTransform, selectById: (id) => select(byId(id), true),
    get scene() { return editScene; }, get layer() { return editLayer; },
    get undoDepth() { return undoStack.length; }, get redoDepth() { return redoStack.length; },
    setLayer(l) { editLayer = l; layerSel.value = l; previewLayer(); },
    get selected() { return selected; } };
  console.log('[capsule] editor attached —', capsule.editable.length, 'editable, scene', editScene);
}

// ── overlay DOM + styles ────────────────────────────────
function injectUI() {
  // Satoshi for the editor chrome (dev-time overlay only; falls back to system-ui offline).
  if (!document.getElementById('cap-font')) {
    const l = document.createElement('link');
    l.id = 'cap-font'; l.rel = 'stylesheet';
    l.href = 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700,900&display=swap';
    document.head.appendChild(l);
  }
  // YG3 luxury dark-admin tokens (mirror of tokens.ts), scoped --cap-* to avoid
  // clobbering the host game's vars. Near-black surfaces, gold accent, Satoshi,
  // Apple easing. Editor chrome only — not part of the shipped game.
  const css = `
    :root{
      --cap-raised:rgba(14,14,20,0.96);
      --cap-surface:rgba(255,255,255,0.015); --cap-hover:rgba(255,255,255,0.04);
      --cap-border:rgba(255,255,255,0.06); --cap-border-strong:rgba(255,255,255,0.12);
      --cap-text:#fff; --cap-muted:rgba(255,255,255,0.65); --cap-dim:rgba(255,255,255,0.45);
      --cap-brand:#D4A04A; --cap-brand-hi:#E8B84B; --cap-brand-soft:rgba(212,160,74,0.08);
      --cap-brand-soft-hi:rgba(212,160,74,0.14); --cap-brand-border:rgba(212,160,74,0.30);
      --cap-on-brand:#0A0A0E; --cap-warn:#fbbf24;
      --cap-font:'Satoshi','Inter',system-ui,-apple-system,sans-serif;
      --cap-ease:cubic-bezier(0.16,1,0.3,1);
      --cap-shadow:0 10px 30px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.35);
    }
    .cap-bar,.cap-panel,.cap-hud,.cap-insp{font-family:var(--cap-font);-webkit-font-smoothing:antialiased;
      color:var(--cap-text);background:var(--cap-raised);border:1px solid var(--cap-border);
      box-shadow:var(--cap-shadow);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3)}
    .cap-bar{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:3px;
      align-items:center;padding:6px;border-radius:14px;font-size:12.5px;
      flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 28px)}
    .cap-bar button,.cap-bar select{font:inherit;font-weight:600;color:var(--cap-muted);background:transparent;
      border:1px solid transparent;padding:7px 11px;border-radius:8px;cursor:pointer;
      transition:background .12s var(--cap-ease),color .12s var(--cap-ease),border-color .12s var(--cap-ease)}
    .cap-bar button:hover{background:var(--cap-hover);color:var(--cap-text)}
    .cap-bar select{color:var(--cap-text);background:var(--cap-surface);border-color:var(--cap-border)}
    .cap-bar select:hover{border-color:var(--cap-border-strong)}
    .cap-bar button.on{background:var(--cap-brand-soft);color:var(--cap-brand);border-color:var(--cap-brand-border)}
    .cap-bar #cap-save{background:var(--cap-brand);border-color:var(--cap-brand);color:var(--cap-on-brand);font-weight:700}
    .cap-bar #cap-save:hover{background:var(--cap-brand-hi);border-color:var(--cap-brand-hi)}
    .cap-bar #cap-save.dirty{box-shadow:0 0 0 3px var(--cap-brand-soft-hi)}
    .cap-bar .sep{width:1px;height:20px;background:var(--cap-border);margin:0 3px}
    .cap-bar label{color:var(--cap-dim);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin:0 1px 0 5px}
    .cap-panel{position:fixed;top:64px;left:14px;z-index:99999;width:206px;max-height:62vh;overflow:auto;border-radius:14px;font-size:12.5px}
    .cap-panel h3{margin:0;padding:12px 14px 10px;font-size:10px;font-weight:700;color:var(--cap-dim);text-transform:uppercase;
      letter-spacing:.18em;background:var(--cap-raised);position:sticky;top:0;border-bottom:1px solid var(--cap-border)}
    .cap-cat{padding:11px 14px 4px;color:var(--cap-brand);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em}
    .cap-cat.cap-warn{color:var(--cap-warn)}
    .cap-item{padding:7px 14px 7px 16px;color:var(--cap-muted);cursor:pointer;border-radius:7px;margin:1px 6px;
      transition:background .12s var(--cap-ease),color .12s var(--cap-ease)}
    .cap-item:hover{background:var(--cap-hover);color:var(--cap-text)}
    .cap-item.sel{background:var(--cap-brand-soft);color:var(--cap-brand);box-shadow:inset 2px 0 0 var(--cap-brand)}
    .cap-item.cap-untagged{color:var(--cap-warn);opacity:.85}
    .cap-hud{position:fixed;bottom:14px;left:14px;z-index:99999;white-space:pre;color:var(--cap-muted);
      border-radius:12px;padding:10px 13px;font-size:11.5px;line-height:1.55;letter-spacing:.01em}
    .cap-insp{position:fixed;bottom:14px;right:14px;z-index:99999;display:none;border-radius:12px;padding:11px 13px}
    .cap-insp .row{display:flex;align-items:center;gap:5px;margin:3px 0}
    .cap-insp .row b{width:18px;color:var(--cap-dim);font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
    .cap-insp input{width:60px;background:var(--cap-surface);border:1px solid var(--cap-border);color:var(--cap-text);border-radius:6px;
      padding:5px 7px;font:inherit;font-size:11px;font-variant-numeric:tabular-nums;
      transition:border-color .12s var(--cap-ease),box-shadow .12s var(--cap-ease)}
    .cap-insp input:hover{border-color:var(--cap-border-strong)}
    .cap-insp input:focus{outline:none;border-color:var(--cap-brand-border);box-shadow:0 0 0 3px var(--cap-brand-soft)}
    .cap-panel::-webkit-scrollbar{width:8px}
    .cap-panel::-webkit-scrollbar-thumb{background:var(--cap-border-strong);border-radius:8px}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const bar = document.createElement('div'); bar.className = 'cap-bar';
  bar.innerHTML =
    `<label>scene</label><select id="cap-scene"></select>` +
    `<label>layer</label><select id="cap-layer"></select><div class="sep"></div>` +
    `<button id="cap-t" class="on">Move</button><button id="cap-r">Rotate</button><button id="cap-s">Scale</button>` +
    `<div class="sep"></div><button id="cap-undo" title="Undo (⌘Z)">↶</button><button id="cap-redo" title="Redo (⌘⇧Z)">↷</button>` +
    `<div class="sep"></div><button id="cap-home" title="Back to the welcome screen">⌂</button><button id="cap-code" title="Open the project in VS Code">&lt;/&gt;</button>` +
    `<div class="sep"></div><button id="cap-play" title="Play the game (drop ?edit)">▶ Play</button><button id="cap-save">Save</button>`;
  document.body.appendChild(bar);

  const panel = document.createElement('div'); panel.className = 'cap-panel';
  panel.innerHTML = `<h3>EDITABLE</h3><div id="cap-list"></div>`;
  document.body.appendChild(panel);

  const hud = document.createElement('div'); hud.className = 'cap-hud'; hud.textContent = 'capsule editor';
  document.body.appendChild(hud);

  const insp = document.createElement('div'); insp.className = 'cap-insp';
  insp.innerHTML =
    `<div class="row"><b>P</b><input id="px"><input id="py"><input id="pz"></div>` +
    `<div class="row"><b>R°</b><input id="rx"><input id="ry"><input id="rz"></div>` +
    `<div class="row"><b>S</b><input id="sx"><input id="sy"><input id="sz"></div>`;
  document.body.appendChild(insp);
  const inspInputs = {};
  for (const k of ['px','py','pz','rx','ry','rz','sx','sy','sz']) inspInputs[k] = insp.querySelector('#' + k);

  return {
    hud, list: panel.querySelector('#cap-list'), saveBtn: bar.querySelector('#cap-save'),
    sceneSel: bar.querySelector('#cap-scene'), layerSel: bar.querySelector('#cap-layer'),
    undoBtn: bar.querySelector('#cap-undo'), redoBtn: bar.querySelector('#cap-redo'),
    playBtn: bar.querySelector('#cap-play'), homeBtn: bar.querySelector('#cap-home'),
    codeBtn: bar.querySelector('#cap-code'), inspEl: insp, inspInputs,
    modeBtns: { translate: bar.querySelector('#cap-t'), rotate: bar.querySelector('#cap-r'), scale: bar.querySelector('#cap-s') },
  };
}
