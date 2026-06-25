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

async function openProject(dir, { launchCode = true } = {}) {
  projectDir = dir;
  ensureMcpConfig(dir);
  if (server) { server.close(); server = null; }
  server = await startServer(dir);
  const { port } = server.address();
  const entry = findEntry(dir);
  app.addRecentDocument(dir);
  win.setTitle(`Capsule — ${path.basename(dir)}`);
  win.loadURL(`http://127.0.0.1:${port}/${entry}?edit`);
  if (launchCode) openInVSCode();
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

// The AI box — a window running the configured agent CLI in the project, in a real
// PTY (xterm + node-pty). The agent sees the live editor through the MCP server.
function openTerminal() {
  if (!projectDir) { dialog.showMessageBox(win, { message: 'Open a project first.' }); return; }
  if (termWin && !termWin.isDestroyed()) { termWin.focus(); return; }
  termWin = new BrowserWindow({
    width: 720, height: 820, backgroundColor: '#15151b', title: 'Capsule · AI',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  termWin.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommand() } });
  termWin.on('closed', () => { termWin = null; });
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
  if (termWin && !termWin.isDestroyed()) termWin.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommand() } });
}

function openInVSCode() {
  if (!projectDir) return { ok: false, error: 'no project' };
  try {
    spawn('code', [projectDir], { detached: true, stdio: 'ignore' }).unref();
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

function buildMenu() {
  const tmpl = [
    { label: 'Capsule', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Project', submenu: [
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => pickProject() },
      { label: 'Toggle Play / Edit', accelerator: 'CmdOrCtrl+E', click: () => togglePlayEdit() },
      { type: 'separator' },
      { label: 'AI Box', accelerator: 'CmdOrCtrl+J', click: () => openTerminal() },
      { label: 'Set AI Agent…', click: () => chooseAgent() },
      { label: 'Open in VS Code', accelerator: 'CmdOrCtrl+Shift+C', click: () => openInVSCode() },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
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
}

app.whenReady().then(async () => {
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
  else await pickProject();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
