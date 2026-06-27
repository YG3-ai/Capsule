// Capsule editor — desktop app (main process).
//
// Opens a Capsule project, serves it from an embedded localhost server (so ES
// modules + importmap + fetch work), loads the game's ?edit view, and gives the
// editor overlay a real filesystem to save into — no browser file picker. Also
// opens the project in VS Code so you edit code and place objects side by side.

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startMcp, MCP_PORT } = require('./mcp.js');

let win = null;
let termWin = null;
let projectDir = null;
let server = null;

// ── config (which AI agent CLI to run) ────────────────────
const cfgPath = () => path.join(app.getPath('userData'), 'capsule-config.json');
function getConfig() { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; } }
function setConfig(patch) { const c = { ...getConfig(), ...patch }; try { fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2)); } catch {} return c; }
const agentCommand = () => getConfig().agent || 'claude';
const getRecents = () => getConfig().recents || [];
function pushRecent(dir) {
  const r = getRecents().filter((x) => x.path !== dir);
  r.unshift({ path: dir, name: path.basename(dir) });
  setConfig({ recents: r.slice(0, 8) });
}

// ── projects home (like Unreal: all capsules live under one folder) ──────────
// Default to ~/Capsule — deliberately NOT ~/Documents, which is iCloud-synced and
// has eaten files before. Configurable via config.projectsRoot.
const projectsRoot = () => getConfig().projectsRoot || path.join(app.getPath('home'), 'Capsule');
function ensureProjectsRoot() { const r = projectsRoot(); try { fs.mkdirSync(r, { recursive: true }); } catch {} return r; }
function readMeta(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'capsule.json'), 'utf8')).meta || {}; } catch { return {}; } }
const isCapsule = (dir) => fs.existsSync(path.join(dir, 'index.html')) || fs.existsSync(path.join(dir, 'capsule.json'));
function listProjects() {
  const root = ensureProjectsRoot();
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
  const out = [];
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    if (!isCapsule(dir)) continue;
    const meta = readMeta(dir);
    let mtime = 0; try { mtime = fs.statSync(dir).mtimeMs; } catch {}
    out.push({ name: d.name, path: dir, kind: meta.kind || '3d', platform: meta.platform || 'pc', mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'image/vnd.radiance', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.fbx': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function startServer(root) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { res.writeHead(400); return res.end('Bad request'); }
      if (rel === '/' || rel === '') rel = '/index.html';
      // Always serve the canonical editor overlay so EVERY project — even ones
      // scaffolded before an update — gets the latest editor (buttons, add-prop,
      // scenes/states) without re-copying files into the capsule.
      if (rel === '/capsule-edit.js') {
        return fs.readFile(path.join(__dirname, 'template', 'capsule-edit.js'), (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': 'text/javascript' });
          res.end(data);
        });
      }
      const fp = path.normalize(path.join(root, rel));
      if (fp !== root && !fp.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': mimeFor(fp) });
        res.end(data);
      });
    });
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// Decide which HTML to open (and which scene data file it edits).
function findEntry(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'capsule.json'), 'utf8'));
    const scenes = m.scenes && Object.values(m.scenes);
    if (scenes && scenes[0] && scenes[0].entry) return scenes[0].entry;
    if (m.entry) return m.entry;
  } catch { /* no manifest */ }
  for (const f of ['index.html', 'dead_mall.html', 'game.html']) {
    if (fs.existsSync(path.join(dir, f))) return f;
  }
  const html = fs.readdirSync(dir).find((f) => f.endsWith('.html'));
  return html || 'index.html';
}

// Wire the project's Claude Code (and the AI box agent) to the editor MCP, if not already.
function ensureMcpConfig(dir) {
  const f = path.join(dir, '.mcp.json');
  if (fs.existsSync(f)) return;
  try {
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { capsule: { type: 'http', url: `http://127.0.0.1:${MCP_PORT}/mcp` } } }, null, 2) + '\n');
  } catch { /* ignore */ }
}

// Welcome screen — shown when no project is open.
function showWelcome() {
  projectDir = null;
  if (server) { server.close(); server = null; }
  win.setTitle('Capsule');
  win.loadFile('welcome.html');
}

// In-window screens (all loaded into the main window, all use preload → capsuleHost).
function showNewProject() {
  projectDir = null; if (server) { server.close(); server = null; }
  win.setTitle('Capsule — New project'); win.loadFile('newproject.html');
}
function showBrowse() {
  projectDir = null; if (server) { server.close(); server = null; }
  win.setTitle('Capsule — Projects'); win.loadFile('browse.html');
}
// Menu "New Project…" opens the chooser screen (2D/3D · PC/Mobile).
function newProject() { showNewProject(); }

// Scaffold a fresh capsule from the bundled template into the projects home, then open it.
async function createProject({ name, kind = '3d', platform = 'pc' } = {}) {
  const safe = String(name || '').trim().replace(/[^a-zA-Z0-9 ._-]/g, '').replace(/\s+/g, '-') || 'untitled-game';
  const dir = path.join(ensureProjectsRoot(), safe);
  if (fs.existsSync(dir)) return { ok: false, error: `"${safe}" already exists in your Capsule folder` };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(path.join(__dirname, 'template'), dir, { recursive: true });
    if (kind === '2d') fs.copyFileSync(path.join(__dirname, 'template-2d.html'), path.join(dir, 'index.html'));
    // record kind + platform in the manifest so the editor and viewport know
    let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(dir, 'capsule.json'), 'utf8')); } catch {}
    m.meta = { kind, platform };
    fs.writeFileSync(path.join(dir, 'capsule.json'), JSON.stringify(m, null, 2) + '\n');
    await openProject(dir);
    return { ok: true, path: dir };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function openProject(dir, { launchCode = true } = {}) {
  projectDir = dir;
  pushRecent(dir);
  ensureMcpConfig(dir);
  if (server) { server.close(); server = null; }
  server = await startServer(dir);
  const { port } = server.address();
  const entry = findEntry(dir);
  app.addRecentDocument(dir);
  win.setTitle(`Capsule — ${path.basename(dir)}`);
  win.loadURL(`http://127.0.0.1:${port}/${entry}?edit`);
  applyPlatformViewport(dir);
  if (launchCode) openInVSCode();
}

// Mobile projects open at a phone viewport so you design for the real screen.
function applyPlatformViewport(dir) {
  if (readMeta(dir).platform === 'mobile') setViewport(390, 844);
}

// Flip the open game between edit mode (?edit, overlay) and play mode (real game).
function togglePlayEdit() {
  if (!win) return;
  try {
    const u = new URL(win.webContents.getURL());
    if (u.searchParams.has('edit')) u.searchParams.delete('edit'); else u.searchParams.set('edit', '');
    win.loadURL(u.toString());
  } catch { /* no game loaded yet */ }
}

// Conversation continuity: Claude Code already stores per-project history as JSONL
// under ~/.claude/projects/<encoded-path>/. If a session exists for this project, run
// `claude --continue` so reopening the project drops you back into the same chat.
function hasClaudeSession(dir) {
  const home = app.getPath('home');
  const cands = [dir.replace(/\//g, '-'), dir.replace(/[/.]/g, '-')];   // Claude's dir encoding
  for (const enc of cands) {
    try { if (fs.readdirSync(path.join(home, '.claude', 'projects', enc)).some((f) => f.endsWith('.jsonl'))) return true; } catch {}
  }
  return false;
}
function agentCommandFor(dir) {
  const base = agentCommand();
  if (/^claude(\s|$)/.test(base) && !/(--continue|--resume|\s-c\b|\s-r\b)/.test(base) && dir && hasClaudeSession(dir)) {
    return base.replace(/^claude/, 'claude --continue');   // resume the existing chat
  }
  return base;
}

// The AI box — a window running the configured agent CLI in the project, in a real
// PTY (xterm + node-pty). The agent sees the live editor through the MCP server.
function openTerminal() {
  if (!projectDir) { dialog.showMessageBox(win, { message: 'Open a project first.' }); return; }
  if (termWin && !termWin.isDestroyed()) { termWin.focus(); return; }
  termWin = new BrowserWindow({
    width: 720, height: 820, backgroundColor: '#0A0A0E', title: 'Capsule · AI',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  termWin.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommandFor(projectDir) } });
  termWin.on('closed', () => { termWin = null; });
}

// Export the open project to a native app. Runs the repo's build script in a live
// terminal window so the user watches progress; output lands in export/dist (desktop)
// or mobile-export/ (a Capacitor project to open in Xcode / Android Studio).
function exportGame(target, mobile = false) {
  if (!projectDir) { dialog.showMessageBox(win, { message: 'Open a project first.' }); return; }
  const repo = path.join(__dirname, '..');
  const script = path.join(repo, mobile ? 'mobile-export' : 'export', 'build.sh');
  if (!fs.existsSync(script)) {
    dialog.showMessageBox(win, { type: 'info', message: 'Export tooling not found',
      detail: `Expected:\n${script}\n\nExport runs from the Capsule repo (dev mode). It isn't bundled into the packaged app yet.` });
    return;
  }
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const cmd = `bash ${q(script)} ${target} --capsule ${q(projectDir)}`;
  const w = new BrowserWindow({
    width: 820, height: 540, backgroundColor: '#0A0A0E',
    title: `Capsule · Export (${mobile ? 'mobile' : 'desktop'})`,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  w.loadFile('terminal.html', { query: { dir: repo, cmd } });
}

// A small modal text prompt (Electron has no built-in one).
function showPrompt(message, value = '') {
  return new Promise((resolve) => {
    const pw = new BrowserWindow({
      width: 480, height: 165, parent: win, modal: true, resizable: false, minimizable: false,
      maximizable: false, title: '', backgroundColor: '#1c1c24',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    pw.setMenu(null);
    pw.loadFile('prompt.html', { query: { msg: message, value } });
    const onDone = (_e, v) => { ipcMain.removeListener('prompt:done', onDone); if (!pw.isDestroyed()) pw.close(); resolve(v); };
    ipcMain.on('prompt:done', onDone);
    pw.on('closed', () => { ipcMain.removeListener('prompt:done', onDone); resolve(null); });
  });
}

async function chooseAgent() {
  const opts = ['claude', 'claude --continue', 'codex', 'aider', 'Custom…', 'Cancel'];
  const r = dialog.showMessageBoxSync(win, {
    type: 'question', message: 'AI agent',
    detail: 'Which CLI should the AI box run? (uses that tool\'s own auth)\n"claude --continue" resumes your last conversation in this project.',
    buttons: opts, cancelId: 5, defaultId: 0,
  });
  if (r >= 5) return;
  let cmd = opts[r];
  if (cmd === 'Custom…') {
    cmd = await showPrompt('Agent command — e.g. "claude --continue" or "aider --model gpt-4o"', agentCommand());
    if (!cmd || !cmd.trim()) return;
    cmd = cmd.trim();
  }
  setConfig({ agent: cmd });
  if (termWin && !termWin.isDestroyed()) termWin.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommandFor(projectDir) } });
}

function openInVSCode() {
  if (!projectDir) return { ok: false, error: 'no project' };
  try {
    const child = spawn('code', [projectDir], { detached: true, stdio: 'ignore' });
    // ENOENT (no `code` on PATH) is emitted async as an 'error' event, not thrown —
    // handle it so a missing VS Code CLI never crashes the app.
    child.on('error', (e) => console.warn('[capsule] VS Code launch skipped:', e.message));
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function pickProject() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open a Capsule project', properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  await openProject(r.filePaths[0]);
  return r.filePaths[0];
}

// ── IPC: the overlay's bridge to disk + tooling ──────────
ipcMain.handle('capsule:save', (_e, { name, json }) => {
  if (!projectDir) return { ok: false, error: 'no project open' };
  const safe = path.basename(name || 'capsule.scenes.json');     // never escape the project dir
  const file = path.join(projectDir, safe);
  try { fs.writeFileSync(file, json); return { ok: true, path: file }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('capsule:code', () => openInVSCode());
ipcMain.handle('capsule:pick', () => pickProject());
ipcMain.handle('capsule:saveAsset', (_e, { name, buffer }) => {
  if (!projectDir) return { ok: false, error: 'no project open' };
  const safe = path.basename(name || 'asset.glb');
  const dir = path.join(projectDir, 'assets', 'models');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safe), Buffer.from(buffer));
    return { ok: true, path: 'assets/models/' + safe };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('capsule:new', () => newProject());
ipcMain.handle('capsule:recents', () => getRecents());
ipcMain.handle('capsule:openPath', (_e, p) => openProject(p));
ipcMain.handle('capsule:projects', () => ({ root: ensureProjectsRoot(), projects: listProjects(), recents: getRecents() }));
ipcMain.handle('capsule:create', (_e, opts) => createProject(opts));
ipcMain.handle('capsule:welcome', () => showWelcome());
ipcMain.handle('capsule:browse', () => showBrowse());
ipcMain.handle('capsule:newScreen', () => showNewProject());
ipcMain.handle('capsule:revealProjects', () => shell.openPath(ensureProjectsRoot()));
ipcMain.handle('capsule:viewport', (_e, { w, h }) => setViewport(w, h));
ipcMain.handle('capsule:export', (_e, { target, mobile }) => exportGame(target, mobile));

// Resize the window to a target device size so you can design for it — the game
// fills the window via its own resize handler. (PC vs Mobile "mode" preview.)
function setViewport(w, h) {
  if (!win) return;
  win.setContentSize(w, h);
  win.center();
}

function buildMenu() {
  const tmpl = [
    { label: 'Capsule', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Project', submenu: [
      { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => showNewProject() },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => pickProject() },
      { label: 'Browse Projects…', accelerator: 'CmdOrCtrl+Shift+O', click: () => showBrowse() },
      { label: 'Welcome Screen', accelerator: 'CmdOrCtrl+Shift+H', click: () => showWelcome() },
      { label: 'Toggle Play / Edit', accelerator: 'CmdOrCtrl+E', click: () => togglePlayEdit() },
      { type: 'separator' },
      { label: 'AI Box', accelerator: 'CmdOrCtrl+J', click: () => openTerminal() },
      { label: 'Set AI Agent…', click: () => chooseAgent() },
      { label: 'Open in VS Code', accelerator: 'CmdOrCtrl+Shift+C', click: () => openInVSCode() },
      { type: 'separator' },
      { label: 'Export', submenu: [
        { label: 'Desktop App (this OS)…', click: () => exportGame(process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux') },
        { label: 'Desktop App — all platforms…', click: () => exportGame('all') },
        { label: 'Mobile (iOS + Android)…', click: () => exportGame('both', true) },
      ] },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
    ] },
    { label: 'Viewport', submenu: [
      { label: 'Desktop', accelerator: 'CmdOrCtrl+1', click: () => setViewport(1280, 800) },
      { label: 'Phone — 390 × 844', accelerator: 'CmdOrCtrl+2', click: () => setViewport(390, 844) },
      { label: 'Phone landscape — 844 × 390', click: () => setViewport(844, 390) },
      { label: 'Tablet — 820 × 1180', accelerator: 'CmdOrCtrl+3', click: () => setViewport(820, 1180) },
    ] },
    { role: 'viewMenu' }, { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#15151b', title: 'Capsule',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
  });
  // In Play mode (a served project page without ?edit) the editor overlay isn't loaded,
  // so inject a visible way back to the editor.
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    if (!/^http:\/\/127\.0\.0\.1/.test(url) || /[?&]edit\b/.test(url)) return;
    win.webContents.executeJavaScript(`(() => {
      if (document.getElementById('__cap_bar')) return;
      const host = window.capsuleHost || {};
      const bar = document.createElement('div'); bar.id = '__cap_bar';
      bar.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;gap:6px;font:600 12px 'Satoshi','Inter',system-ui,sans-serif";
      const mk = (label, fn, primary) => {
        const b = document.createElement('button'); b.textContent = label; b.onclick = fn;
        b.style.cssText = 'padding:8px 12px;border-radius:9px;cursor:pointer;font:inherit;backdrop-filter:blur(10px);border:1px solid '
          + (primary ? '#D4A04A;background:#D4A04A;color:#0A0A0E;font-weight:700'
                     : 'rgba(255,255,255,0.10);background:rgba(14,14,20,0.92);color:rgba(255,255,255,0.85)');
        return b;
      };
      bar.appendChild(mk('✎ Edit', () => { const u = new URL(location.href); u.searchParams.set('edit',''); location.href = u.toString(); }, true));
      bar.appendChild(mk('</> Code', () => host.openInVSCode && host.openInVSCode()));
      bar.appendChild(mk('⌂ Welcome', () => host.welcome && host.welcome()));
      document.body.appendChild(bar);
    })();`).catch(() => {});
  });
}

app.whenReady().then(async () => {
  // Branded dock/taskbar icon for dev (`npm start`); packaged builds use build/icon.* .
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch {}
  }
  createWindow();
  buildMenu();
  startMcp(() => win);   // expose the live editor to Claude over MCP
  // A project can be passed for CLI/testing: `npm start -- <dir>`, `capsule <dir>`,
  // or CAPSULE_PROJECT=… . Skip '.' (electron's app-path arg) and the app dir itself.
  const argDir = process.argv.slice(1).find((a) => {
    if (a === '.' || a.startsWith('-')) return false;
    try { return fs.statSync(a).isDirectory() && path.resolve(a) !== __dirname; } catch { return false; }
  });
  const initial = process.env.CAPSULE_PROJECT || argDir;
  if (initial) await openProject(initial, { launchCode: !process.env.CAPSULE_NO_CODE });
  else showWelcome();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
