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
  orbit.enableDamping = true; orbit.dampingFactor = 0.12;
  orbit.target.set(camera.position.x, 1, camera.position.z - 10);
  orbit.update();
  let flyOn = false; const keysHeld = new Set();   // WASD/QE fly when Fly is on

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
  gizmo.addEventListener('objectChange', () => { writeSelected(); markDirty(); if (isLoose(selected)) upsertMeshEdit(selected, xform(selected)); });
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
  const { hud, list, saveBtn, modeBtns, sceneSel, layerSel, undoBtn, redoBtn, playBtn, homeBtn, codeBtn,
          addBtn, frameBtn, flyBtn, aiBtn, meshBtn, matEl, colInput, texName, texRepBtn, texDelBtn,
          pop, ask, inspEl, inspInputs } = ui;
  // The editor has its own HUD — hide the game's top-left HUD so they don't overlap.
  const gameHud = document.getElementById('hud'); if (gameHud) gameHud.style.display = 'none';
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  // Play = run the real game (drop ?edit). Saved placements still apply on load.
  playBtn.onclick = () => { const u = new URL(location.href); u.searchParams.delete('edit'); location.href = u.toString(); };
  // Home / VS Code need the Capsule app bridge; hide them in a plain browser.
  const host = window.capsuleHost;
  if (host && host.welcome) homeBtn.onclick = () => host.welcome(); else homeBtn.style.display = 'none';
  if (host && host.openInVSCode) codeBtn.onclick = () => host.openInVSCode(); else codeBtn.style.display = 'none';

  // ── edit ANY mesh (walls, floors, structure) + materials/textures ──────
  // Untagged structural meshes aren't in capsule.editable, so we persist their
  // edits by a stable signature (name + geometry + original position) under
  // capsule.data.scenes[scene].meshEdits, and re-apply by matching on load.
  let pickAll = false;
  const _texLoader = new THREE.TextureLoader();
  const isMeshObj = (o) => !!(o && o.isMesh);
  const isLoose = (o) => !!o && !isTracked(o);   // any untracked object (mesh OR untagged asset group)
  // Baked/merged/loop-rebuilt structure (e.g. theConsumed's cbox/cAdd world) can't be
  // individually edited persistently — don't present it as movable.
  const isStructural = (o) => {
    for (let p = o; p; p = p.parent) { const u = p.userData; if (u && (u.corridorBuilt || u.mergeable || u.merged)) return true; }
    return false;
  };
  function allMeshes() {
    const out = [];
    scene.traverse((o) => {
      if (!o.isMesh || isStructural(o)) return;
      for (let p = o; p; p = p.parent) if (p === gizmoHelper) return;   // skip the gizmo's own meshes
      out.push(o);
    });
    return out;
  }
  // meshes + groups (the things mesh-edits can target), excluding the gizmo + baked structure
  function allTargets() {
    const out = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isGroup || o.type === 'Group' || o.type === 'Object3D') || isStructural(o)) return;
      for (let p = o; p; p = p.parent) if (p === gizmoHelper) return;
      out.push(o);
    });
    return out;
  }
  function meshSig(m) {
    const op = m.userData.__origPos || [r3(m.position.x), r3(m.position.y), r3(m.position.z)];
    return { name: m.name || '', geo: (m.geometry && m.geometry.type) || '', pos: op };
  }
  const sigKey = (s) => `${s.name}|${s.geo}|${s.pos.join(',')}`;
  const nearPos = (p, a) => Math.abs(p.x - a[0]) < 0.06 && Math.abs(p.y - a[1]) < 0.06 && Math.abs(p.z - a[2]) < 0.06;
  function ensureMeshEdits() { const sc = ensureScene(); if (!sc.meshEdits) sc.meshEdits = []; return sc.meshEdits; }
  function upsertMeshEdit(mesh, patch) {
    if (!isMeshObj(mesh)) return;
    if (!mesh.userData.__origPos) mesh.userData.__origPos = [r3(mesh.position.x), r3(mesh.position.y), r3(mesh.position.z)];
    const sig = meshSig(mesh); const list = ensureMeshEdits();
    let e = list.find((x) => sigKey(x.sig) === sigKey(sig));
    if (!e) { e = { sig }; list.push(e); }
    Object.assign(e, patch);
    markDirty();
  }
  function applyMap(m, mapPath) {
    if (!m.material) return;
    if (!mapPath) { m.material.map = null; }
    else { const t = _texLoader.load(mapPath); t.colorSpace = THREE.SRGBColorSpace; m.material.map = t; }
    m.material.needsUpdate = true;
  }
  function reapplyMeshEdits() {
    const sc = capsule.data.scenes && capsule.data.scenes[editScene];
    if (!sc || !sc.meshEdits) return;
    const meshes = allTargets();
    for (const e of sc.meshEdits) {
      const m = meshes.find((x) => !x.userData.__meDone && (x.name || '') === e.sig.name
        && ((x.geometry && x.geometry.type) || '') === e.sig.geo && nearPos(x.position, e.sig.pos));
      if (!m) continue;
      m.userData.__meDone = true; m.userData.__origPos = e.sig.pos;
      if (e.position) m.position.set(e.position[0], e.position[1], e.position[2]);
      if (e.rotation) m.rotation.set(e.rotation[0] * DEG, e.rotation[1] * DEG, e.rotation[2] * DEG);
      if (e.scale) m.scale.set(e.scale[0], e.scale[1], e.scale[2]);
      if (e.color && m.material && m.material.color) m.material.color.set(e.color);
      if ('map' in e) applyMap(m, e.map);
    }
  }
  function refreshMaterial() {
    const m = selected, show = isMeshObj(m) && m.material;
    matEl.style.display = show ? 'block' : 'none';
    if (!show) return;
    if (m.material.color) colInput.value = '#' + m.material.color.getHexString();
    texName.textContent = m.material.map ? 'texture set' : '— none —';
  }

  // ── numeric inspector (type exact transforms) ─────────
  function refreshInspector() {
    const on = selected && (isTracked(selected) || isMeshObj(selected));
    inspEl.style.display = on ? 'block' : 'none';
    refreshMaterial();
    if (!on) return;
    const t = xform(selected);
    inspInputs.px.value = t.position[0]; inspInputs.py.value = t.position[1]; inspInputs.pz.value = t.position[2];
    inspInputs.rx.value = t.rotation[0]; inspInputs.ry.value = t.rotation[1]; inspInputs.rz.value = t.rotation[2];
    inspInputs.sx.value = t.scale[0];    inspInputs.sy.value = t.scale[1];    inspInputs.sz.value = t.scale[2];
  }
  function applyInspector() {
    if (!selected || !(isTracked(selected) || isMeshObj(selected))) return;
    const num = (k, fallback) => { const v = parseFloat(inspInputs[k].value); return Number.isFinite(v) ? v : fallback; };
    const before = snap(selected);
    selected.position.set(num('px', selected.position.x), num('py', selected.position.y), num('pz', selected.position.z));
    selected.rotation.set(num('rx', selected.rotation.x / DEG) * DEG, num('ry', selected.rotation.y / DEG) * DEG, num('rz', selected.rotation.z / DEG) * DEG);
    selected.scale.set(num('sx', selected.scale.x), num('sy', selected.scale.y), num('sz', selected.scale.z));
    pushUndo(selected, before, snap(selected));
    markDirty(); writeSelected();
    if (isLoose(selected)) upsertMeshEdit(selected, xform(selected));
  }
  for (const k in inspInputs) inspInputs[k].addEventListener('change', applyInspector);

  // material controls (color + texture replace / remove) for the selected mesh
  function wireMaterial() {
    colInput.oninput = () => {
      if (!isMeshObj(selected) || !selected.material.color) return;
      selected.material.color.set(colInput.value); upsertMeshEdit(selected, { color: colInput.value });
    };
    texRepBtn.onclick = async () => {
      if (!isMeshObj(selected)) return;
      if (!(window.capsuleHost && window.capsuleHost.importAsset)) return flash('texture import needs the Capsule app');
      const r = await window.capsuleHost.importAsset();
      if (!r || r.canceled) return;
      if (!r.ok) return flash('import failed: ' + (r.error || '?'));
      applyMap(selected, './' + r.path); upsertMeshEdit(selected, { map: './' + r.path });
      refreshMaterial(); flash('texture → ' + r.name);
    };
    texDelBtn.onclick = () => {
      if (!isMeshObj(selected)) return;
      applyMap(selected, null); upsertMeshEdit(selected, { map: null });
      refreshMaterial(); flash('texture removed');
    };
  }
  wireMaterial();

  function layersFor(sceneName) {
    const code = (capsule.scenes[sceneName] && capsule.scenes[sceneName].states) || [];
    const data = Object.keys((capsule.data.scenes && capsule.data.scenes[sceneName] && capsule.data.scenes[sceneName].states) || {});
    return ['base', ...new Set([...code, ...data])];   // Base + code-defined + editor-added states
  }
  function labelFor(layer) {
    if (layer === 'base') return 'Base · all states';
    const labels = (capsule.scenes[editScene] && capsule.scenes[editScene].labels) || {};
    return labels[layer] || layer;
  }
  function populateScenePickers() {
    sceneSel.innerHTML = '';
    const names = new Set([...Object.keys(capsule.scenes), ...Object.keys(capsule.data.scenes || {}), editScene]);
    for (const name of names) {
      if (!name) continue;
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
    if (sc && sc.setState) sc.setState((sc.states && sc.states[0]) || 'base');  // drive a code-defined scene
    else if (capsule.setActiveScene) capsule.setActiveScene(editScene);          // data-driven: show only this scene's objects
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
    if (pickAll) {   // mesh mode — pick any mesh (walls, floors, structure)
      const hit = ray.intersectObjects(allMeshes(), true)[0];
      return select(hit ? hit.object : null);
    }
    const objs = capsule.editable.map((e) => e.obj);
    const hit = ray.intersectObjects(objs, true)[0];
    let o = hit ? hit.object : null;
    while (o && !objs.includes(o)) o = o.parent;
    if (o) return select(o, false);
    // fall back: click an untagged asset (the ⚠ list items) right in the viewport
    const untag = findUntagged();
    if (untag.length) {
      const uhit = ray.intersectObjects(untag, true)[0];
      if (uhit) { let u = uhit.object; while (u && !untag.includes(u)) u = u.parent; if (u) return select(u, false); }
    }
    select(null);
  });

  function select(obj, frame = false) {
    selected = obj;
    if (obj) {
      if (isLoose(obj) && !obj.userData.__origPos) obj.userData.__origPos = [r3(obj.position.x), r3(obj.position.y), r3(obj.position.z)];
      gizmo.attach(obj); if (frame) frameObject(obj);
    } else gizmo.detach();
    refreshList();
    writeSelected();
  }
  function idOf(obj) { const e = capsule.editable.find((e) => e.obj === obj); return e ? e.id : '(?)'; }

  function writeSelected() {
    refreshInspector();
    const tag = `scene: ${editScene}   layer: ${editLayer}`;
    if (!selected) { hud.textContent = `${tag}\n${capsule.editable.length} editable · click one`; return; }
    if (!isTracked(selected)) {
      const what = isMeshObj(selected) ? 'mesh' : 'untagged';
      hud.textContent = `${tag}\n${what} · ${selected.name || (selected.geometry && selected.geometry.type) || 'object'}  ·  ` +
        `drag to move (saved by position)\ntag it for a stable id + grouping:  ${suggestTag(selected)}`;
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
        div.onclick = () => select(obj, true);
        const nm = document.createElement('span'); nm.className = 'cap-item-name'; nm.textContent = id; div.appendChild(nm);
        const acts = document.createElement('span'); acts.className = 'cap-item-acts';
        const dup = document.createElement('button'); dup.className = 'cap-item-act'; dup.textContent = '⧉'; dup.title = 'Duplicate';
        dup.onclick = (e) => { e.stopPropagation(); duplicateObj(obj); };
        const del = document.createElement('button'); del.className = 'cap-item-act'; del.textContent = '🗑'; del.title = 'Delete';
        del.onclick = (e) => { e.stopPropagation(); deleteObj(obj); };
        acts.appendChild(dup); acts.appendChild(del); div.appendChild(acts);
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
      // Base = full transform of every editable (preserve a deleted entity's hidden flag).
      for (const { id, obj } of capsule.editable) {
        const prev = sc.base[id];
        sc.base[id] = (prev && prev.visible === false) ? { ...xform(obj), visible: false } : xform(obj);
      }
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

  // ── add object / scene / state ────────────────────────
  const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  // In-overlay text prompt (Electron disables window.prompt; this is styled to match).
  function askName(label, def = '') {
    return new Promise((resolve) => {
      const lbl = ask.querySelector('#cap-ask-lbl'), inp = ask.querySelector('#cap-ask-in');
      const okB = ask.querySelector('#cap-ask-ok'), caB = ask.querySelector('#cap-ask-cancel');
      lbl.textContent = label; inp.value = def; ask.style.display = 'flex'; inp.focus(); inp.select();
      const close = (v) => { ask.style.display = 'none'; inp.removeEventListener('keydown', onKey);
        okB.removeEventListener('click', ok); caB.removeEventListener('click', cancel); resolve(v); };
      const onKey = (e) => { if (e.key === 'Enter') close(inp.value); else if (e.key === 'Escape') close(null); };
      const ok = () => close(inp.value), cancel = () => close(null);
      inp.addEventListener('keydown', onKey); okB.addEventListener('click', ok); caB.addEventListener('click', cancel);
    });
  }
  const PRIMS = {
    box:      { make: () => new THREE.BoxGeometry(1, 1, 1),                y: 0.5 },
    sphere:   { make: () => new THREE.SphereGeometry(0.6, 24, 16),        y: 0.6 },
    cylinder: { make: () => new THREE.CylinderGeometry(0.4, 0.4, 2.5, 20), y: 1.25 },
  };
  function placeInFront(y) {
    const front = new THREE.Vector3(); camera.getWorldDirection(front); front.y = 0;
    if (front.lengthSq() < 1e-6) front.set(0, 0, -1); front.normalize();
    const t = orbit.target.clone().add(front.multiplyScalar(3)); t.y = y; return t;
  }
  function meshFor(shape, color) {
    const spec = PRIMS[shape] || PRIMS.box; const c = color || 0x9aa0aa;
    // a touch of emissive so the prop reads in lit 3D *and* unlit 2D scenes
    const m = new THREE.Mesh(spec.make(), new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, emissive: c, emissiveIntensity: 0.3 }));
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function recordAdded(prop) {
    const sc = ensureScene(); if (!sc.added) sc.added = [];
    if (!sc.added.find((a) => a.id === prop.id)) sc.added.push(prop);
    if (capsule._added) capsule._added.add(prop.id);
  }
  // A primitive added in the editor; persisted in the 'added' list (with a geo descriptor)
  // so it survives reload and shows up in the played game too.
  function addPrimitive(shape) {
    const spec = PRIMS[shape] || PRIMS.box;
    const m = meshFor(shape, 0x9aa0aa);
    m.position.copy(placeInFront(spec.y)); m.userData.capsuleAdded = true; scene.add(m);
    const id = shape + '-' + Math.random().toString(36).slice(2, 6);
    capsule.registerEditable(m, id, 'prop');
    recordAdded({ id, geo: { shape }, color: '#9aa0aa', type: 'prop',
      position: [r3(m.position.x), r3(m.position.y), r3(m.position.z)], rotation: [0, 0, 0], scale: [1, 1, 1] });
    refreshList(); select(m, false); markDirty(); flash('added ' + shape);
  }
  function makePrimitiveFromProp(a) {
    const m = meshFor(a.geo.shape, a.color ? new THREE.Color(a.color).getHex() : 0x9aa0aa);
    m.userData.capsuleAdded = true;
    if (a.position) m.position.set(a.position[0], a.position[1], a.position[2]);   // added items carry their own transform
    if (a.rotation) m.rotation.set(a.rotation[0] * DEG, a.rotation[1] * DEG, a.rotation[2] * DEG);
    if (a.scale)    m.scale.set(a.scale[0], a.scale[1], a.scale[2]);
    scene.add(m);
    capsule.registerEditable(m, a.id, a.type || 'prop');
    return m;
  }
  // Recreate editor-added primitives + prop clones that the game's (possibly older)
  // hook didn't. GLBs are left to the game hook; clones whose source isn't built yet
  // are skipped and retried on the next call.
  function ensureAddedPrimitives() {
    const sc = capsule.data.scenes && capsule.data.scenes[editScene];
    if (!sc || !sc.added) return;
    for (const a of sc.added) {
      if (capsule.editable.some((e) => e.id === a.id)) continue;
      if (a.geo) makePrimitiveFromProp(a);
      else if (a.clone) cloneTrackedFromProp(a);
    }
  }
  async function addSceneFn() {
    const name = slug(await askName('Name for the new scene'));
    if (!name) return;
    if (!capsule.data.scenes) capsule.data.scenes = {};
    if (!capsule.data.scenes[name]) capsule.data.scenes[name] = { base: {}, states: {}, added: [] };
    editScene = name; editLayer = 'base';
    if (capsule.setActiveScene) capsule.setActiveScene(name);
    populateScenePickers(); refreshList(); writeSelected(); markDirty();
    flash('scene "' + name + '" — place objects, then Save');
  }
  async function addStateFn() {
    const name = slug(await askName('Name for the new state (e.g. night, boss, cleared)'));
    if (!name || name === 'base') return flash('pick another name');
    const sc = ensureScene(); if (!sc.states) sc.states = {};
    if (!sc.states[name]) sc.states[name] = {};
    editLayer = name; populateLayerPicker(); previewLayer(); markDirty();
    flash('state "' + name + '" — edits here save as deltas vs Base');
  }

  // ── add asset (file picker) · duplicate · delete ──────
  // Load a model that's already in the project's assets/ and drop it in front of the camera.
  async function importModelAtTarget(relPath, fileName) {
    const base = fileName.replace(/\.(glb|gltf)$/i, '').toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'model';
    const id = base + '-' + Math.random().toString(36).slice(2, 6);
    const front = new THREE.Vector3(); camera.getWorldDirection(front); front.y = 0;
    if (front.lengthSq() < 1e-6) front.set(0, 0, -1); front.normalize();
    const tgt = orbit.target.clone().add(front.multiplyScalar(3));
    const prop = { id, src: './' + relPath, type: 'model', position: [r3(tgt.x), 0, r3(tgt.z)], rotation: [0, 0, 0], scale: [1, 1, 1] };
    try {
      const obj = await capsule.addObject(prop);
      let box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = maxDim > 3 ? 2.5 / maxDim : (maxDim < 0.3 ? 1 / maxDim : 1);
      obj.scale.setScalar(s); obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj);
      obj.position.y = r3(-box.min.y);
      prop.scale = [r3(s), r3(s), r3(s)]; prop.position = [r3(obj.position.x), r3(obj.position.y), r3(obj.position.z)];
      refreshList(); select(obj, true); markDirty(); flash('added ' + fileName);
    } catch (err) { flash('load failed: ' + err.message); }
  }
  // "+ Add ▸ Asset" — opens the OS file picker (same result as dragging a file in).
  async function addAsset() {
    if (!window.capsuleHost || !window.capsuleHost.importAsset) { flash('asset import needs the Capsule app'); return; }
    flash('choose a file…');
    const r = await window.capsuleHost.importAsset();
    if (!r || r.canceled) { writeSelected(); return; }
    if (!r.ok) { flash('import failed: ' + (r.error || '?')); return; }
    if (/\.(glb|gltf)$/i.test(r.name)) await importModelAtTarget(r.path, r.name);
    else flash('imported ' + r.name + ' → ' + r.path);   // texture/audio: copied; reference it from code
  }
  const baseId = (id) => id.replace(/-[a-z0-9]{4}$/, '');
  // Build an "added"-style descriptor for any duplicable object: an existing added
  // asset (GLB/primitive), a recognised game primitive (Box / Sphere / Cylinder), or —
  // for a code-built prop (a Group with no single geometry) — a `clone` descriptor that
  // records "a copy of source-id + this transform" and is reproduced by deep-cloning the
  // live source object on load. Stays plain readable data in capsule.scenes.json.
  function describeFor(obj, id) {
    const sc = ensureScene();
    const a = (sc.added || []).find((x) => x.id === id);
    if (a) return { ...a };
    const x = xform(obj);
    const type = obj.userData.capsuleType || 'prop';
    const t = obj.geometry && obj.geometry.type;
    const shape = t === 'SphereGeometry' ? 'sphere' : t === 'CylinderGeometry' ? 'cylinder' : t === 'BoxGeometry' ? 'box' : null;
    if (shape) {
      const color = (obj.material && obj.material.color) ? '#' + obj.material.color.getHexString() : '#9aa0aa';
      return { id, geo: { shape }, color, type, position: x.position, rotation: x.rotation, scale: x.scale };
    }
    // Code-built prop: duplicate by cloning the live source (by its id) at load time.
    return { id, clone: id, type, position: x.position, rotation: x.rotation, scale: x.scale };
  }
  // Recreate a duplicated code-built prop by deep-cloning its live source object.
  function cloneTrackedFromProp(a) {
    const src = capsule.editable.find((e) => e.id === a.clone);
    if (!src || !src.obj) return null;                     // source not built yet — caller retries
    const o = src.obj.clone(true);
    o.userData.capsuleAdded = true;
    if (a.position) o.position.set(a.position[0], a.position[1], a.position[2]);
    if (a.rotation) o.rotation.set(a.rotation[0] * DEG, a.rotation[1] * DEG, a.rotation[2] * DEG);
    if (a.scale)    o.scale.set(a.scale[0], a.scale[1], a.scale[2]);
    scene.add(o);
    capsule.registerEditable(o, a.id, a.type || src.type || 'prop');
    return o;
  }
  const idOfObj = (obj) => (capsule.editable.find((e) => e.obj === obj) || {}).id;
  async function duplicateObj(obj) {
    if (!obj) return flash('select an object first');
    const id0 = idOfObj(obj); if (!id0) return flash('select an object first');
    const d = describeFor(obj, id0);
    if (!d) return flash("can't duplicate this one — it isn't a prop or asset");
    const nid = baseId(id0) + '-' + Math.random().toString(36).slice(2, 6);
    const p = d.position || [0, 0, 0];
    const copy = { ...d, id: nid, position: [p[0] + 1, p[1], p[2] + 1] };   // offset so the copy is visible
    recordAdded(copy);
    const o = copy.geo ? makePrimitiveFromProp(copy)
      : copy.clone ? cloneTrackedFromProp(copy)
      : await capsule.addObject(copy);
    if (!o) return flash("couldn't clone — source not loaded yet, try again");
    refreshList(); select(o, false); markDirty(); flash('duplicated → ' + nid);
  }
  function deleteObj(obj) {
    if (!obj) return flash('select an object first');
    const id0 = idOfObj(obj); if (!id0) return;
    const sc = ensureScene();
    const inAdded = (sc.added || []).some((x) => x.id === id0);
    gizmo.detach();
    if (obj.parent) obj.parent.remove(obj);
    capsule.editable = capsule.editable.filter((e) => e.obj !== obj);
    if (capsule._added) capsule._added.delete(id0);
    if (inAdded) { sc.added = sc.added.filter((x) => x.id !== id0); if (sc.base) delete sc.base[id0]; }   // added asset → gone for good
    else { if (!sc.base) sc.base = {}; sc.base[id0] = { ...(sc.base[id0] || xform(obj)), visible: false }; }  // game entity → hidden persistently
    if (selected === obj) selected = null;
    refreshList(); writeSelected(); markDirty(); flash('deleted ' + id0);
  }
  const duplicateSelected = () => duplicateObj(selected);
  const deleteSelected = () => deleteObj(selected);

  // ── add popover ───────────────────────────────────────
  addBtn.onclick = (e) => {
    e.stopPropagation();
    if (pop.style.display === 'flex') { pop.style.display = 'none'; return; }
    const r = addBtn.getBoundingClientRect();
    pop.style.left = Math.round(r.left) + 'px'; pop.style.top = Math.round(r.bottom + 6) + 'px';
    pop.style.display = 'flex';
  };
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pop.style.display = 'none';
    const act = b.dataset.act;
    if (act === 'scene') addSceneFn(); else if (act === 'state') addStateFn(); else if (act === 'asset') addAsset();
  });
  window.addEventListener('pointerdown', (e) => { if (pop.style.display === 'flex' && !pop.contains(e.target) && e.target !== addBtn) pop.style.display = 'none'; }, true);

  // ── traversal: frame · fly · double-click focus ───────
  function frameAll() {
    const objs = (selected && isTracked(selected)) ? [selected] : capsule.editable.map((e) => e.obj);
    if (!objs.length) return;
    const box = new THREE.Box3(); for (const o of objs) box.expandByObject(o);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const rad = Math.max(size.x, size.y, size.z) || 4;
    orbit.target.copy(c);
    camera.position.set(c.x + rad, c.y + rad * 0.6, c.z + rad); camera.lookAt(c); orbit.update();
  }
  frameBtn.onclick = () => frameAll();
  flyBtn.onclick = () => { flyOn = !flyOn; flyBtn.classList.toggle('on', flyOn); keysHeld.clear();
    flash(flyOn ? 'fly on — W A S D move · Q E down/up' : 'fly off'); };
  meshBtn.onclick = () => { pickAll = !pickAll; meshBtn.classList.toggle('on', pickAll);
    if (!pickAll && isLoose(selected)) select(null);
    flash(pickAll ? 'mesh mode — click any wall / floor / mesh to edit + retexture' : 'mesh mode off'); };
  // ✨ AI box toggle — needs the app bridge; hide it in a plain browser.
  if (window.capsuleHost && window.capsuleHost.toggleAI) aiBtn.onclick = () => window.capsuleHost.toggleAI();
  else aiBtn.style.display = 'none';
  renderer.domElement.addEventListener('dblclick', (e) => {
    ptr.x = (e.clientX / window.innerWidth) * 2 - 1; ptr.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const objs = capsule.editable.map((e) => e.obj);
    const hit = ray.intersectObjects(objs, true)[0];
    let o = hit ? hit.object : null; while (o && !objs.includes(o)) o = o.parent;
    if (o) { select(o); frameObject(o); }
  });

  // overlay render loop: orbit damping + WASD fly movement
  (function loop() {
    if (flyOn && keysHeld.size) {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const move = new THREE.Vector3();
      if (keysHeld.has('w')) move.add(fwd);
      if (keysHeld.has('s')) move.sub(fwd);
      if (keysHeld.has('d')) move.add(right);
      if (keysHeld.has('a')) move.sub(right);
      if (keysHeld.has('e')) move.y += 1;
      if (keysHeld.has('q')) move.y -= 1;
      if (move.lengthSq()) { move.normalize().multiplyScalar(0.15); camera.position.add(move); orbit.target.add(move); }
    }
    orbit.update();
    requestAnimationFrame(loop);
  })();

  // ── keyboard ──────────────────────────────────────────
  window.addEventListener('keyup', (e) => { keysHeld.delete(e.key.toLowerCase()); }, true);
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (flyOn && !e.metaKey && !e.ctrlKey && 'wasdqe'.includes(k)) { keysHeld.add(k); return; }   // fly owns WASD/QE
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); }
    else if ((e.metaKey || e.ctrlKey) && k === 's') { e.preventDefault(); save(); }
    else if (k === 'w') setMode('translate');
    else if (k === 'e') setMode('rotate');
    else if (k === 'r') setMode('scale');
    else if (k === 'f') frameAll();
    else if (k === 'd') duplicateSelected();
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === 'escape') select(null);
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
    await importModelAtTarget(r.path, file.name);   // shared with "+ Add ▸ Asset"
  });

  setMode('translate');
  populateScenePickers();
  ensureAddedPrimitives();   // recreate editor-added primitives the game hook didn't
  reapplyMeshEdits();        // re-apply saved wall/floor/material edits
  setTimeout(reapplyMeshEdits, 800);   // ...again for meshes the game builds async
  refreshList();             // populate the panel immediately on attach
  writeSelected();
  capsule.editor = { select, frameObject, setMode, save, previewLayer, buildLayer, undo, redo, applyInspector,
    addPrimitive, addScene: addSceneFn, addState: addStateFn, addAsset, duplicate: duplicateSelected, remove: deleteSelected, frameAll,
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
    .cap-bar{position:fixed;top:14px;left:0;right:0;margin:0 auto;width:fit-content;z-index:99999;display:flex;gap:3px;
      align-items:center;padding:6px;border-radius:14px;font-size:13px;
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
    .cap-item{padding:6px 10px 6px 16px;color:var(--cap-muted);cursor:pointer;border-radius:7px;margin:1px 6px;
      display:flex;align-items:center;gap:6px;transition:background .12s var(--cap-ease),color .12s var(--cap-ease)}
    .cap-item:hover{background:var(--cap-hover);color:var(--cap-text)}
    .cap-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cap-item-acts{display:flex;gap:1px;opacity:0;transition:opacity .12s var(--cap-ease)}
    .cap-item:hover .cap-item-acts{opacity:1}
    .cap-item-act{background:transparent;border:0;color:var(--cap-dim);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:5px}
    .cap-item-act:hover{background:var(--cap-border-strong);color:var(--cap-text)}
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
    .cap-insp .cap-mat{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--cap-border)}
    .cap-insp .cap-colin{width:36px;height:22px;padding:0;border:1px solid var(--cap-border);border-radius:5px;background:none;cursor:pointer}
    .cap-insp .cap-texname{flex:1;color:var(--cap-dim);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cap-insp .cap-texbtn{font:inherit;font-weight:600;font-size:10.5px;color:var(--cap-muted);background:var(--cap-surface);
      border:1px solid var(--cap-border);border-radius:5px;padding:3px 7px;cursor:pointer}
    .cap-insp .cap-texbtn:hover{border-color:var(--cap-border-strong);color:var(--cap-text)}
    .cap-panel::-webkit-scrollbar{width:8px}
    .cap-panel::-webkit-scrollbar-thumb{background:var(--cap-border-strong);border-radius:8px}
    .cap-bar button.on{background:var(--cap-brand-soft);color:var(--cap-brand);border-color:var(--cap-brand-border)}
    .cap-pop{position:fixed;z-index:100000;display:none;flex-direction:column;min-width:170px;padding:6px;
      background:var(--cap-raised);border:1px solid var(--cap-border);border-radius:12px;box-shadow:var(--cap-shadow);
      backdrop-filter:blur(14px) saturate(1.3);font-family:var(--cap-font);color:var(--cap-text)}
    .cap-pop .h{padding:8px 10px 4px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--cap-dim)}
    .cap-pop button{display:block;width:100%;text-align:left;font:inherit;font-size:13px;font-weight:600;color:var(--cap-muted);
      background:transparent;border:0;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background .12s var(--cap-ease),color .12s var(--cap-ease)}
    .cap-pop button:hover{background:var(--cap-hover);color:var(--cap-text)}
    .cap-ask{position:fixed;inset:0;z-index:100001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
    .cap-ask .box{background:var(--cap-raised);border:1px solid var(--cap-border);border-radius:14px;padding:18px;width:320px;
      box-shadow:var(--cap-shadow);font-family:var(--cap-font)}
    .cap-ask .lbl{color:var(--cap-muted);font-size:13px;margin-bottom:10px}
    .cap-ask input{width:100%;background:var(--cap-surface);border:1px solid var(--cap-border);color:var(--cap-text);
      border-radius:8px;padding:9px 11px;font:inherit;font-size:14px}
    .cap-ask input:focus{outline:none;border-color:var(--cap-brand-border);box-shadow:0 0 0 3px var(--cap-brand-soft)}
    .cap-ask .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
    .cap-ask .row button{font:inherit;font-weight:700;font-size:13px;padding:8px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--cap-border);background:transparent;color:var(--cap-muted)}
    .cap-ask .row button#cap-ask-ok{background:var(--cap-brand);border-color:var(--cap-brand);color:var(--cap-on-brand)}
    /* bigger, clearer icon buttons */
    .cap-bar button.ic{font-size:16px;min-width:36px;padding:7px 8px;display:inline-flex;align-items:center;justify-content:center;line-height:1}
    .cap-bar #cap-ai{font-size:15px}
    /* hover tooltip — tells you what each icon does */
    .cap-bar [data-tip]{position:relative}
    .cap-bar [data-tip]:hover::after{content:attr(data-tip);position:absolute;top:calc(100% + 9px);left:50%;transform:translateX(-50%);
      white-space:nowrap;background:var(--cap-raised);border:1px solid var(--cap-border);color:var(--cap-text);font-family:var(--cap-font);
      font-size:11px;font-weight:600;padding:5px 8px;border-radius:7px;box-shadow:var(--cap-shadow);pointer-events:none;z-index:100002;letter-spacing:.02em}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const bar = document.createElement('div'); bar.className = 'cap-bar';
  bar.innerHTML =
    `<label>scene</label><select id="cap-scene"></select>` +
    `<label>layer</label><select id="cap-layer"></select><div class="sep"></div>` +
    `<button id="cap-t" class="on">Move</button><button id="cap-r">Rotate</button><button id="cap-s">Scale</button>` +
    `<div class="sep"></div><button id="cap-add">＋ Add</button>` +
    `<div class="sep"></div><button class="ic" id="cap-mesh" data-tip="Edit any mesh — walls, floors, structure">▦</button>` +
    `<button class="ic" id="cap-frame" data-tip="Frame · F">⛶</button><button class="ic" id="cap-fly" data-tip="Fly · W A S D / Q E">✥</button>` +
    `<button class="ic" id="cap-undo" data-tip="Undo · ⌘Z">↶</button><button class="ic" id="cap-redo" data-tip="Redo · ⌘⇧Z">↷</button>` +
    `<div class="sep"></div><button class="ic" id="cap-home" data-tip="Welcome screen">⌂</button><button class="ic" id="cap-code" data-tip="Open in VS Code">&lt;/&gt;</button><button class="ic" id="cap-ai" data-tip="AI box · ⌘J">✨</button>` +
    `<div class="sep"></div><button id="cap-play" data-tip="Play the game">▶ Play</button><button id="cap-save">Save</button>`;
  document.body.appendChild(bar);

  const pop = document.createElement('div'); pop.className = 'cap-pop';
  pop.innerHTML =
    `<div class="h">Add</div>` +
    `<button data-act="asset">⬚&nbsp;&nbsp;Asset (.glb / image)…</button>` +
    `<div class="h">Structure</div>` +
    `<button data-act="scene">＋&nbsp;&nbsp;New scene…</button><button data-act="state">＋&nbsp;&nbsp;New state…</button>`;
  document.body.appendChild(pop);

  const ask = document.createElement('div'); ask.className = 'cap-ask';
  ask.innerHTML = `<div class="box"><div class="lbl" id="cap-ask-lbl"></div><input id="cap-ask-in" autocomplete="off" />` +
    `<div class="row"><button id="cap-ask-cancel">Cancel</button><button id="cap-ask-ok">OK</button></div></div>`;
  document.body.appendChild(ask);

  const panel = document.createElement('div'); panel.className = 'cap-panel';
  panel.innerHTML = `<h3>EDITABLE</h3><div id="cap-list"></div>`;
  document.body.appendChild(panel);

  const hud = document.createElement('div'); hud.className = 'cap-hud'; hud.textContent = 'capsule editor';
  document.body.appendChild(hud);

  const insp = document.createElement('div'); insp.className = 'cap-insp';
  insp.innerHTML =
    `<div class="row"><b>P</b><input id="px"><input id="py"><input id="pz"></div>` +
    `<div class="row"><b>R°</b><input id="rx"><input id="ry"><input id="rz"></div>` +
    `<div class="row"><b>S</b><input id="sx"><input id="sy"><input id="sz"></div>` +
    `<div class="cap-mat" id="cap-mat">` +
      `<div class="row"><b>COL</b><input type="color" id="cap-col" class="cap-colin"></div>` +
      `<div class="row"><b>TEX</b><span id="cap-texname" class="cap-texname">—</span>` +
        `<button id="cap-tex-rep" class="cap-texbtn">Replace</button><button id="cap-tex-del" class="cap-texbtn" title="Remove texture">✕</button></div>` +
    `</div>`;
  document.body.appendChild(insp);
  const inspInputs = {};
  for (const k of ['px','py','pz','rx','ry','rz','sx','sy','sz']) inspInputs[k] = insp.querySelector('#' + k);

  return {
    hud, list: panel.querySelector('#cap-list'), saveBtn: bar.querySelector('#cap-save'),
    sceneSel: bar.querySelector('#cap-scene'), layerSel: bar.querySelector('#cap-layer'),
    undoBtn: bar.querySelector('#cap-undo'), redoBtn: bar.querySelector('#cap-redo'),
    playBtn: bar.querySelector('#cap-play'), homeBtn: bar.querySelector('#cap-home'),
    codeBtn: bar.querySelector('#cap-code'), addBtn: bar.querySelector('#cap-add'),
    frameBtn: bar.querySelector('#cap-frame'), flyBtn: bar.querySelector('#cap-fly'),
    aiBtn: bar.querySelector('#cap-ai'), meshBtn: bar.querySelector('#cap-mesh'),
    matEl: insp.querySelector('#cap-mat'), colInput: insp.querySelector('#cap-col'),
    texName: insp.querySelector('#cap-texname'), texRepBtn: insp.querySelector('#cap-tex-rep'),
    texDelBtn: insp.querySelector('#cap-tex-del'),
    pop, ask, inspEl: insp, inspInputs,
    modeBtns: { translate: bar.querySelector('#cap-t'), rotate: bar.querySelector('#cap-r'), scale: bar.querySelector('#cap-s') },
  };
}
