// Capsule DOM editor overlay.
//
// The DOM counterpart of capsule-edit.js (three.js). Capsule's editor MCP tools
// only need a `window.capsule.editor` on the page + a window screenshot, neither
// of which is three.js-bound — so this provides that same API for plain
// HTML/CSS/canvas games. The app injects it in edit mode ONLY when the page
// hasn't already attached an editor, so three.js capsules are untouched and any
// imported web game gets the editor for free.
//
// It edits with CSS transforms (translate + scale) applied to ANY element you
// click — no tagging required — so it works on imported games. It persists the
// tweaks to capsule.scenes.json (keyed by a stable selector, or by a
// data-capsule id when present) and re-applies them on load.
//
//   • Move mode — click any element to select it, drag to move, drag the corner
//     handle to scale. Elements with data-capsule="<id>" persist by that id.
//   • Pin mode — drop numbered reference pins for the AI's LOOK.
//   • Save — write transforms to capsule.scenes.json.
//
// Self-contained IIFE (injected via executeJavaScript); no imports, no build.
(function () {
  if (window.capsule && window.capsule.editor) return;   // never double-attach

  var host = window.capsuleHost || null;
  var pins = [];                 // { n, x, y, el, marker }
  var mode = 'off';              // 'off' | 'move' | 'pin'
  var edits = new Map();         // key -> { el, tx, ty, scale }
  var selectedEl = null;
  var drag = null;               // move: { el, sx, sy, tx0, ty0 }
  var scaling = null;            // scale: { el, cx, cy, d0, s0 }

  var root = document.createElement('div');
  root.id = 'cap-edit';
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:600 12px system-ui,sans-serif';
  document.body.appendChild(root);

  var bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:2147483646;' +
    'pointer-events:auto;background:rgba(14,14,20,.92);border:1px solid rgba(255,255,255,.12);' +
    'border-radius:10px;padding:5px;box-shadow:0 6px 20px rgba(0,0,0,.5)';
  root.appendChild(bar);
  function mkBtn(label) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'pointer-events:auto;font:inherit;padding:6px 12px;border-radius:7px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.14);background:transparent;color:#fff';
    return b;
  }
  var moveBtn = mkBtn('↔ Move'), pinBtn = mkBtn('📌 Pin'), undoBtn = mkBtn('↶'), redoBtn = mkBtn('↷'),
      resetBtn = mkBtn('Reset'), clearBtn = mkBtn('Clear'), saveBtn = mkBtn('💾 Save');
  undoBtn.title = 'Undo (Ctrl+Z)'; redoBtn.title = 'Redo (Ctrl+Y / Ctrl+Shift+Z)';
  [moveBtn, pinBtn, undoBtn, redoBtn, resetBtn, clearBtn, saveBtn].forEach(function (b) { bar.appendChild(b); });
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // Selection box + a bottom-right scale handle (above the capture layer).
  var sel = document.createElement('div');
  sel.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #D4A04A;border-radius:3px;z-index:2147483300;display:none';
  root.appendChild(sel);
  var handle = document.createElement('div');
  handle.title = 'Drag to resize';
  handle.style.cssText = 'position:fixed;width:16px;height:16px;border-radius:50%;background:#D4A04A;border:2px solid #0A0A0E;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.6);cursor:nwse-resize;pointer-events:auto;z-index:2147483560;display:none';
  root.appendChild(handle);

  var capture = document.createElement('div');
  capture.style.cssText = 'position:fixed;inset:0;pointer-events:auto;background:transparent;z-index:2147483500';

  function paint(b, on) { b.style.background = on ? '#D4A04A' : 'transparent'; b.style.color = on ? '#0A0A0E' : '#fff'; }
  function setMode(m) {
    mode = m;
    paint(moveBtn, m === 'move'); paint(pinBtn, m === 'pin');
    capture.style.cursor = m === 'pin' ? 'crosshair' : 'default';
    if (m === 'off') { if (capture.parentNode) capture.remove(); }
    else if (!capture.isConnected) root.appendChild(capture);
    if (m !== 'move') deselect();
  }
  moveBtn.addEventListener('click', function () { setMode(mode === 'move' ? 'off' : 'move'); });
  pinBtn.addEventListener('click', function () { setMode(mode === 'pin' ? 'off' : 'pin'); });
  clearBtn.addEventListener('click', function () { clearPins(); });
  saveBtn.addEventListener('click', function () { save(); });
  resetBtn.addEventListener('click', function () { if (selectedEl) { pushHistory(); var e = entryFor(selectedEl); e.tx = 0; e.ty = 0; e.scale = 1; applyTf(selectedEl); syncSelUI(); } });

  // ---- transforms ----
  function keyFor(el) { return el.getAttribute && el.getAttribute('data-capsule') ? '[data-capsule="' + el.getAttribute('data-capsule') + '"]' : cssPath(el); }
  function entryFor(el) {
    var k = keyFor(el);
    var e = edits.get(k);
    if (!e) { e = { el: el, tx: 0, ty: 0, scale: 1 }; edits.set(k, e); }
    else { e.el = el; }
    return e;
  }
  function applyTf(el) {
    var e = entryFor(el);
    el.style.transformOrigin = 'center center';
    el.style.transform = 'translate(' + e.tx + 'px,' + e.ty + 'px) scale(' + e.scale + ')';
  }

  // ---- undo / redo (snapshots of the transform state) ----
  var history = [], future = [];
  function snapshot() { var s = {}; edits.forEach(function (e, k) { s[k] = { tx: e.tx, ty: e.ty, scale: e.scale }; }); return s; }
  function restore(s) {
    var keys = {}; edits.forEach(function (_e, k) { keys[k] = 1; }); Object.keys(s).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var el; try { el = document.querySelector(k); } catch (_) { el = null; } if (!el) return;
      var t = s[k] || { tx: 0, ty: 0, scale: 1 };
      edits.set(k, { el: el, tx: t.tx, ty: t.ty, scale: t.scale }); applyTf(el);
    });
    syncSelUI();
  }
  function pushHistory() { history.push(snapshot()); if (history.length > 60) history.shift(); future.length = 0; }
  function undo() { if (!history.length) return; future.push(snapshot()); restore(history.pop()); }
  function redo() { if (!future.length) return; history.push(snapshot()); restore(future.pop()); }

  // ---- selection ----
  function select(el) {
    selectedEl = el;
    entryFor(el);
    api.selected = { userData: { capsuleId: keyFor(el) } };
    syncSelUI();
  }
  function deselect() { selectedEl = null; api.selected = null; sel.style.display = 'none'; handle.style.display = 'none'; }
  function syncSelUI() {
    if (!selectedEl) return;
    var r = selectedEl.getBoundingClientRect();
    sel.style.display = 'block'; handle.style.display = 'block';
    sel.style.left = (r.left - 2) + 'px'; sel.style.top = (r.top - 2) + 'px';
    sel.style.width = (r.width + 4) + 'px'; sel.style.height = (r.height + 4) + 'px';
    handle.style.left = (r.right - 8) + 'px'; handle.style.top = (r.bottom - 8) + 'px';
  }

  // ---- move (drag body) ----
  capture.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    if (mode === 'pin') {
      var hit = pins.find(function (p) { return Math.hypot(p.x - x, p.y - y) <= 16; });
      if (hit) { removeMarker(hit.marker); return; }
      addPin(x, y, elementAt(x, y));
      return;
    }
    var el = pickAssetAt(x, y);
    if (!el) { deselect(); return; }
    select(el);
    pushHistory();
    var en = entryFor(el);
    drag = { el: el, sx: x, sy: y, tx0: en.tx, ty0: en.ty };
    try { capture.setPointerCapture(e.pointerId); } catch (_) {}
  });
  capture.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var en = entryFor(drag.el);
    en.tx = drag.tx0 + (e.clientX - drag.sx);
    en.ty = drag.ty0 + (e.clientY - drag.sy);
    applyTf(drag.el); syncSelUI();
  });
  function endDrag(e) { if (drag) { try { capture.releasePointerCapture(e.pointerId); } catch (_) {} drag = null; } }
  capture.addEventListener('pointerup', endDrag);
  capture.addEventListener('pointercancel', endDrag);

  // ---- scale (drag handle) ----
  handle.addEventListener('pointerdown', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (!selectedEl) return;
    pushHistory();
    var r = selectedEl.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var en = entryFor(selectedEl);
    scaling = { el: selectedEl, cx: cx, cy: cy, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), s0: en.scale };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointermove', function (e) {
    if (!scaling) return;
    var d = Math.hypot(e.clientX - scaling.cx, e.clientY - scaling.cy);
    var en = entryFor(scaling.el);
    en.scale = Math.max(0.2, Math.min(6, scaling.s0 * (d / scaling.d0)));
    applyTf(scaling.el); syncSelUI();
  });
  function endScale(e) { if (scaling) { try { handle.releasePointerCapture(e.pointerId); } catch (_) {} scaling = null; } }
  handle.addEventListener('pointerup', endScale);
  handle.addEventListener('pointercancel', endScale);

  // Pick the most specific ASSET under a point: the smallest visible element
  // whose box contains it (rect hit-test, so it works even for pointer-events:none
  // art like the chef), then climb same-size wrappers so we grab the whole asset —
  // not an inner span and not the giant page container. Prefers a data-capsule id.
  function pickAssetAt(x, y) {
    var best = null, bestArea = Infinity;
    var vArea = window.innerWidth * window.innerHeight;
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest('#cap-edit')) continue;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      var area = r.width * r.height;
      if (area > vArea * 0.85) continue;                 // skip near-fullscreen containers
      if (area < bestArea) { bestArea = area; best = el; }
    }
    if (!best) return null;
    var tagged = best.closest && best.closest('[data-capsule]');
    if (tagged) return tagged;
    // Climb wrappers that share ~the same box, so we move the whole asset.
    while (best.parentElement && best.parentElement !== document.body && !best.parentElement.closest('#cap-edit')) {
      var pr = best.parentElement.getBoundingClientRect(), br = best.getBoundingClientRect();
      var pa = pr.width * pr.height, ba = br.width * br.height;
      if (pa <= ba * 1.15 && pa < vArea * 0.85) best = best.parentElement; else break;
    }
    return best;
  }

  // ---- pins ----
  function addPin(x, y, el) {
    var n = pins.length + 1;
    var m = document.createElement('div');
    m.className = 'cap-pin'; m.textContent = String(n);
    m.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%);' +
      'width:24px;height:24px;border-radius:50%;background:#D4A04A;color:#0A0A0E;display:flex;align-items:center;' +
      'justify-content:center;font-weight:800;font-size:12px;border:2px solid #0A0A0E;box-shadow:0 2px 6px rgba(0,0,0,.6);' +
      'pointer-events:none;z-index:2147483400';
    root.appendChild(m);
    pins.push({ n: n, x: x, y: y, el: el, marker: m });
    updateClear();
  }
  function removeMarker(marker) {
    var i = pins.findIndex(function (p) { return p.marker === marker; });
    if (i < 0) return;
    pins[i].marker.remove(); pins.splice(i, 1);
    pins.forEach(function (p, k) { p.n = k + 1; p.marker.textContent = String(p.n); });
    updateClear();
  }
  function clearPins() { var n = pins.length; pins.forEach(function (p) { p.marker.remove(); }); pins.length = 0; updateClear(); return n; }
  function updateClear() { clearBtn.textContent = pins.length ? 'Clear (' + pins.length + ')' : 'Clear'; }

  // ---- helpers ----
  function elementAt(x, y) {
    var had = capture.isConnected;
    if (had) capture.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (had) capture.style.display = '';
    while (el && el.closest && el.closest('#cap-edit')) el = el.parentElement;
    return el;
  }
  function describe(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName.toLowerCase(), id: el.id || undefined,
      capsuleId: (el.getAttribute && el.getAttribute('data-capsule')) || undefined,
      cls: (typeof el.className === 'string' && el.className.trim()) || undefined,
      text: text ? text.slice(0, 80) : undefined, selector: cssPath(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }
  function cssPath(el) {
    var parts = [], cur = el;
    for (var d = 0; cur && cur.nodeType === 1 && d < 5; d++) {
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      var seg = cur.tagName.toLowerCase();
      var fc = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/)[0] : '';
      if (fc) seg += '.' + fc;
      var par = cur.parentElement;
      if (par) {
        var sibs = Array.prototype.filter.call(par.children, function (c) { return c.tagName === cur.tagName; });
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg); cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483646;background:#1e7a3a;' +
      'color:#fff;padding:8px 16px;border-radius:8px;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.5)';
    root.appendChild(t); setTimeout(function () { t.remove(); }, 1600);
  }

  // ---- persistence ----
  function load() {
    if (!location.href.startsWith('http')) return;
    fetch('capsule.scenes.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.transforms) return;
      Object.keys(d.transforms).forEach(function (k) {
        var el; try { el = document.querySelector(k); } catch (_) { el = null; }
        if (!el) return;
        var t = d.transforms[k];
        edits.set(k, { el: el, tx: t.tx || 0, ty: t.ty || 0, scale: t.scale || 1 });
        applyTf(el);
      });
    }).catch(function () {});
  }
  function save() {
    var transforms = {};
    edits.forEach(function (e, k) {
      if (e.tx || e.ty || (e.scale && e.scale !== 1)) transforms[k] = { tx: Math.round(e.tx), ty: Math.round(e.ty), scale: +e.scale.toFixed(3) };
    });
    var json = JSON.stringify({ transforms: transforms }, null, 2);
    if (host && host.saveScenes) { host.saveScenes(json, 'capsule.scenes.json'); toast('Saved ' + Object.keys(transforms).length + ' transform(s)'); }
    else toast('No project host — cannot save');
    return json;
  }

  // ---- editor API the MCP tools call ----
  function list() {
    var out = [], seen = {};
    function add(el, key) {
      if (!el || seen[key]) return; seen[key] = 1;
      var e = edits.get(key) || { tx: 0, ty: 0, scale: 1 };
      out.push({ id: key, type: el.tagName.toLowerCase(), position: [Math.round(e.tx), Math.round(e.ty)], scale: +(e.scale || 1).toFixed(3) });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-capsule]'), function (el) { add(el, keyFor(el)); });
    edits.forEach(function (e, k) { if (e.el) add(e.el, k); });
    return out;
  }
  function byKey(k) { try { return document.querySelector(k); } catch (_) { return null; } }
  function selectById(id) { var el = byKey(id); if (!el) return false; setMode('move'); select(el); return true; }
  function setTransform(id, t) {
    var el = byKey(id); if (!el) return false;
    pushHistory();
    var e = entryFor(el);
    if (t && t.position) { e.tx = t.position[0]; e.ty = t.position[1]; }
    if (t && t.scale) { e.scale = Array.isArray(t.scale) ? t.scale[0] : t.scale; }
    applyTf(el); if (selectedEl === el) syncSelUI();
    return true;
  }
  function lookingAt() {
    return {
      surface: 'dom',
      viewport: { w: window.innerWidth, h: window.innerHeight },
      center: describe(elementAt(window.innerWidth / 2, window.innerHeight / 2)),
      editables: list(),
      pins: pins.map(function (p) { return { n: p.n, x: Math.round(p.x), y: Math.round(p.y), target: describe(p.el) }; }),
      hint: pins.length
        ? ('The user dropped ' + pins.length + ' pin(s); each "target" is the DOM element under that pin.')
        : "In Move mode, click any element to select/drag/scale it; 'editables' lists elements with applied transforms.",
    };
  }

  var api = {
    selected: null, list: list, selectById: selectById, setTransform: setTransform,
    setLayer: function () {}, save: save, lookingAt: lookingAt, clearPins: clearPins, setDevice: function () {},
  };
  window.capsule = window.capsule || {};
  window.capsule.editor = api;

  window.addEventListener('resize', function () { if (selectedEl) syncSelUI(); });
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  load();
  setMode('off');
  console.log('[capsule] DOM editor attached — Move: click any element, drag to move, corner to scale. Pin for reference. Save to persist.');
})();
