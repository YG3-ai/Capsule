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
  const { hud, list, saveBtn, modeBtns, sceneSel, layerSel, undoBtn, redoBtn, playBtn, inspEl, inspInputs } = ui;
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  // Play = run the real game (drop ?edit). Saved placements still apply on load.
  playBtn.onclick = () => { const u = new URL(location.href); u.searchParams.delete('edit'); location.href = u.toString(); };

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
    if (layer === 'base') return 'Base · all loops';
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

  setMode('translate');
  populateScenePickers();
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
  const css = `
    .cap-bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:6px;align-items:center;
      padding:6px;background:rgba(18,18,24,.92);border:1px solid #333;border-radius:8px;font:12px ui-monospace,Menlo,monospace}
    .cap-bar button,.cap-bar select{color:#ddd;background:#2a2a36;border:1px solid #3a3a48;padding:6px 9px;border-radius:5px;cursor:pointer;font:12px ui-monospace,monospace}
    .cap-bar button.on{background:#4fd6c2;border-color:#4fd6c2;color:#000}
    .cap-bar #cap-save{background:#2f7d4f;border-color:#2f7d4f;color:#fff}
    .cap-bar #cap-save.dirty{box-shadow:0 0 0 2px #ffd23f88}
    .cap-bar .sep{width:1px;height:22px;background:#3a3a48;margin:0 2px}
    .cap-bar label{color:#8a8;font-size:10px;margin-right:-2px}
    .cap-panel{position:fixed;top:56px;left:10px;z-index:99999;width:180px;max-height:60vh;overflow:auto;background:rgba(18,18,24,.92);
      border:1px solid #333;border-radius:8px;font:12px ui-monospace,Menlo,monospace}
    .cap-panel h3{margin:0;padding:7px 10px;font-size:11px;color:#9aa;background:#22222c;position:sticky;top:0}
    .cap-cat{padding:5px 10px 3px;color:#4fd6c2;font-size:10px;text-transform:uppercase;letter-spacing:.05em;background:#1c1c24;border-top:1px solid #333}
    .cap-cat.cap-warn{color:#ffd23f}
    .cap-item.cap-untagged{color:#bba24a}
    .cap-item{padding:6px 10px 6px 16px;color:#cce;cursor:pointer;border-top:1px solid #2a2a34}
    .cap-item:hover{background:#2a2a36}.cap-item.sel{background:#4fd6c233;color:#fff}
    .cap-hud{position:fixed;bottom:10px;left:10px;z-index:99999;white-space:pre;color:#cce;background:rgba(18,18,24,.92);
      border:1px solid #333;border-radius:8px;padding:8px 10px;font:12px ui-monospace,Menlo,monospace;line-height:1.5}
    .cap-insp{position:fixed;bottom:10px;right:10px;z-index:99999;display:none;background:rgba(18,18,24,.92);
      border:1px solid #333;border-radius:8px;padding:8px 10px;font:11px ui-monospace,Menlo,monospace;color:#cce}
    .cap-insp .row{display:flex;align-items:center;gap:4px;margin:2px 0}
    .cap-insp .row b{width:16px;color:#8aa;font-weight:400}
    .cap-insp input{width:62px;background:#222;border:1px solid #3a3a48;color:#cce;border-radius:4px;padding:3px 4px;
      font:11px ui-monospace,monospace}
    .cap-insp input:focus{outline:none;border-color:#4fd6c2}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const bar = document.createElement('div'); bar.className = 'cap-bar';
  bar.innerHTML =
    `<label>scene</label><select id="cap-scene"></select>` +
    `<label>layer</label><select id="cap-layer"></select><div class="sep"></div>` +
    `<button id="cap-t" class="on">Move</button><button id="cap-r">Rotate</button><button id="cap-s">Scale</button>` +
    `<div class="sep"></div><button id="cap-undo" title="Undo (⌘Z)">↶</button><button id="cap-redo" title="Redo (⌘⇧Z)">↷</button>` +
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
    playBtn: bar.querySelector('#cap-play'), inspEl: insp, inspInputs,
    modeBtns: { translate: bar.querySelector('#cap-t'), rotate: bar.querySelector('#cap-r'), scale: bar.querySelector('#cap-s') },
  };
}
