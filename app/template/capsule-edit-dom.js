// Capsule DOM editor overlay.
//
// The DOM counterpart of capsule-edit.js (which is three.js-specific). Capsule's
// editor MCP tools only need a `window.capsule.editor` on the page plus a
// window screenshot — neither is three.js-bound — so this provides that same API
// for plain HTML/CSS/canvas games. The app injects it in edit mode ONLY when the
// page hasn't already attached an editor, so three.js capsules are untouched and
// an imported web game gets reference pins + LOOK for free.
//
// Self-contained IIFE (injected via executeJavaScript); no imports, no build.
(function () {
  if (window.capsule && window.capsule.editor) return;   // never double-attach

  var pins = [];        // { n, x, y, el, marker }
  var pinMode = false;

  var root = document.createElement('div');
  root.id = 'cap-edit';
  root.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:600 12px system-ui,sans-serif';
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
    b.style.cssText =
      'pointer-events:auto;font:inherit;padding:6px 12px;border-radius:7px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,.14);background:transparent;color:#fff';
    return b;
  }
  var pinBtn = mkBtn('📌 Pin');
  var clearBtn = mkBtn('Clear');
  bar.appendChild(pinBtn);
  bar.appendChild(clearBtn);

  // Full-window click-catcher, present only while pinning. Sits BELOW the toolbar
  // (lower z) so Pin/Clear stay clickable.
  var capture = document.createElement('div');
  capture.style.cssText =
    'position:fixed;inset:0;cursor:crosshair;pointer-events:auto;background:transparent;z-index:2147483500';

  function setPinMode(on) {
    pinMode = on;
    pinBtn.style.background = on ? '#D4A04A' : 'transparent';
    pinBtn.style.color = on ? '#0A0A0E' : '#fff';
    if (on) root.appendChild(capture);
    else if (capture.parentNode) capture.remove();
  }
  pinBtn.addEventListener('click', function () { setPinMode(!pinMode); });
  clearBtn.addEventListener('click', function () { clearPins(); });

  capture.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    var hit = pins.find(function (p) { return Math.hypot(p.x - x, p.y - y) <= 16; });
    if (hit) { removeMarker(hit.marker); return; }
    addPin(x, y, elementAt(x, y));
  });

  function addPin(x, y, el) {
    var n = pins.length + 1;
    var m = document.createElement('div');
    m.className = 'cap-pin';
    m.textContent = String(n);
    m.style.cssText =
      'position:fixed;left:' + x + 'px;top:' + y + 'px;transform:translate(-50%,-50%);' +
      'width:24px;height:24px;border-radius:50%;background:#D4A04A;color:#0A0A0E;' +
      'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;' +
      'border:2px solid #0A0A0E;box-shadow:0 2px 6px rgba(0,0,0,.6);pointer-events:none;z-index:2147483400';
    root.appendChild(m);
    pins.push({ n: n, x: x, y: y, el: el, marker: m });
    updateClear();
  }
  function removeMarker(marker) {
    var i = pins.findIndex(function (p) { return p.marker === marker; });
    if (i < 0) return;
    pins[i].marker.remove(); pins.splice(i, 1); renumber(); updateClear();
  }
  function clearPins() {
    var n = pins.length;
    pins.forEach(function (p) { p.marker.remove(); });
    pins.length = 0; updateClear();
    return n;
  }
  function renumber() { pins.forEach(function (p, i) { p.n = i + 1; p.marker.textContent = String(p.n); }); }
  function updateClear() { clearBtn.textContent = pins.length ? 'Clear (' + pins.length + ')' : 'Clear'; }

  // Element under a client point, ignoring our own overlay chrome.
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
    var cls = typeof el.className === 'string' ? el.className.trim() : '';
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      cls: cls || undefined,
      text: text ? text.slice(0, 80) : undefined,
      selector: cssPath(el),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }
  function cssPath(el) {
    var parts = [], cur = el;
    for (var d = 0; cur && d < 4; d++) {
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      var seg = cur.tagName.toLowerCase();
      var fc = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/)[0] : '';
      if (fc) seg += '.' + fc;
      var par = cur.parentElement;
      if (par) {
        var sibs = Array.prototype.filter.call(par.children, function (c) { return c.tagName === cur.tagName; });
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function lookingAt() {
    var center = describe(elementAt(window.innerWidth / 2, window.innerHeight / 2));
    return {
      surface: 'dom',
      viewport: { w: window.innerWidth, h: window.innerHeight },
      center: center,
      pins: pins.map(function (p) { return { n: p.n, x: Math.round(p.x), y: Math.round(p.y), target: describe(p.el) }; }),
      hint: pins.length
        ? ('The user dropped ' + pins.length + ' numbered pin(s) on the UI; each "target" is the DOM element under that pin.')
        : "No pins dropped; 'center' is the element under the middle of the view.",
    };
  }

  // The API Capsule's MCP tools call. Object-placement calls are no-ops for a DOM UI.
  window.capsule = window.capsule || {};
  window.capsule.editor = {
    lookingAt: lookingAt,
    clearPins: clearPins,
    selected: null,
    list: function () { return []; },
    selectById: function () { return false; },
    setTransform: function () { return false; },
    setLayer: function () {},
    save: function () {},
    setDevice: function () {},
  };

  setPinMode(false);
  console.log('[capsule] DOM edit overlay attached — drop pins, then LOOK.');
})();
