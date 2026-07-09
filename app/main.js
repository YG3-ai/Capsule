// Capsule editor — desktop app (main process).
//
// Opens a Capsule project, serves it from an embedded localhost server (so ES
// modules + importmap + fetch work), loads the game's ?edit view, and gives the
// editor overlay a real filesystem to save into — no browser file picker. Also
// opens the project in VS Code so you edit code and place objects side by side.

const { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, shell } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const pty = require('node-pty');
const { startMcp, MCP_PORT } = require('./mcp.js');

let win = null;
let aiView = null;       // the AI box, docked inside the editor window (a WebContentsView)
let aiVisible = false;
let projectDir = null;
let server = null;
let mosaicWin = null;    // the Mosaic moodboard window (its own BrowserWindow, per project)

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
  // Normalize to native separators so the "inside root?" guard below works on
  // Windows (a project path passed with '/' would otherwise fail path.sep checks).
  root = path.resolve(root);
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { res.writeHead(400); return res.end('Bad request'); }
      if (rel === '/' || rel === '') rel = '/index.html';
      // Always serve the canonical editor overlay so EVERY project — even ones
      // scaffolded before an update, or that import it from a subfolder (e.g.
      // theConsumed's src/capsule-edit.js) — gets the latest editor (buttons,
      // add-asset, scenes/states) without re-copying files into the capsule.
      if (path.basename(rel) === 'capsule-edit.js') {
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
  destroyAI();
  projectDir = null;
  if (server) { server.close(); server = null; }
  win.setTitle('Capsule');
  win.loadFile('welcome.html');
}

// In-window screens (all loaded into the main window, all use preload → capsuleHost).
function showNewProject() {
  destroyAI(); projectDir = null; if (server) { server.close(); server = null; }
  win.setTitle('Capsule — New project'); win.loadFile('newproject.html');
}
function showBrowse() {
  destroyAI(); projectDir = null; if (server) { server.close(); server = null; }
  win.setTitle('Capsule — Projects'); win.loadFile('browse.html');
}
// Menu "New Project…" opens the chooser screen (2D/3D · PC/Mobile).
function newProject() { showNewProject(); }

// Scaffold a fresh capsule from the bundled template into the projects home, then open it.
// `open: false` scaffolds without switching the editor — used by the design-first flow
// where you spin up an empty game from Mosaic and keep working on the moodboard.
// In the packaged app __dirname lives inside app.asar (a single file), so copying
// app.asar/template with cpSync/copyFileSync throws ENOTDIR ("not a directory").
// These templates are asarUnpack'd to app.asar.unpacked/, so resolve bundled files to
// that real on-disk location. No-op in dev (the path has no app.asar segment).
const bundled = (rel) => path.join(__dirname, rel).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

async function createProject({ name, kind = '3d', platform = 'pc', open = true } = {}) {
  const safe = String(name || '').trim().replace(/[^a-zA-Z0-9 ._-]/g, '').replace(/\s+/g, '-') || 'untitled-game';
  const dir = path.join(ensureProjectsRoot(), safe);
  if (fs.existsSync(dir)) {
    // A real game already lives here → don't clobber it. But an empty/partial folder left
    // by a previously failed create (no index.html) is safe to replace.
    if (fs.existsSync(path.join(dir, 'index.html')))
      return { ok: false, error: `"${safe}" already exists in your Capsule folder` };
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(bundled('template'), dir, { recursive: true });
    if (kind === '2d') fs.copyFileSync(bundled('template-2d.html'), path.join(dir, 'index.html'));
    // record kind + platform in the manifest so the editor and viewport know
    let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(dir, 'capsule.json'), 'utf8')); } catch {}
    m.meta = { kind, platform };
    fs.writeFileSync(path.join(dir, 'capsule.json'), JSON.stringify(m, null, 2) + '\n');
    scaffoldMosaic(dir);   // every project starts with its own (empty) moodboard
    // Register it either way so it lands in Recent + Browse + the Mosaic chooser. Opening
    // a project already records it; a design-first (open:false) create records it directly.
    if (open) await openProject(dir); else pushRecent(dir);
    return { ok: true, path: dir };
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}   // never leave a half-made folder
    return { ok: false, error: String(e.message || e) };
  }
}

// Give a project its own empty moodboard: a `mosaic/` folder with one default board.
// Per-project — never shared. No-op if a mosaic.json already exists.
function scaffoldMosaic(dir) {
  try {
    const id = 'mood-mosaic';
    fs.mkdirSync(path.join(dir, 'mosaic', id), { recursive: true });
    const file = path.join(dir, 'mosaic.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ boards: [{ id, name: 'Mood Mosaic', items: [] }] }, null, 2));
  } catch {}
}

async function openProject(dir, { launchCode = true } = {}) {
  destroyAI();
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
  if (launchCode) showAI();   // AI box is docked by default; VS Code stays a manual action
}

// Mobile is previewed INSIDE the editor — the viewport is framed to a phone (the overlay does this
// automatically for mobile projects), so the app window stays a comfortable desktop size. Here we
// only recover from any old phone-shrunk window left by a previous version.
function applyPlatformViewport(dir) {
  if (!win) return;
  const [w, h] = win.getContentSize();
  if (w < 1000 || h < 700) { win.setContentSize(1360, 860); win.center(); }
}

// Drive the editor's in-viewport device frame (phone / tablet / null=fit). Works in edit mode,
// where the overlay is attached; a no-op in Play mode.
function previewDevice(key) {
  if (!win) return;
  const arg = key ? `'${key}'` : 'null';
  win.webContents.executeJavaScript(`window.capsule && window.capsule.editor && window.capsule.editor.setDevice(${arg})`).catch(() => {});
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
  // For Claude Code, TRY to resume this project's conversation but fall back to a
  // fresh session if there isn't one — `claude --continue` errors out (and exits)
  // when there's no prior conversation, so chain `|| <base>` to recover. `||`
  // works in both cmd.exe and POSIX shells. (No fragile session-file detection.)
  if (/^claude(\s|$)/.test(base) && !/(--continue|--resume|\s-c\b|\s-r\b)/.test(base)) {
    return base.replace(/^claude/, 'claude --continue') + ' || ' + base;
  }
  return base;
}

// The AI box — docked as a panel inside the editor window (not a separate window).
// It runs the agent CLI in a real PTY (xterm + node-pty), so it needs its own
// nodeIntegration; a WebContentsView gives it that while staying embedded. The ✨
// button shows/hides it; the agent sees the live editor through the MCP server.
const AI_TOP = 92;   // sit below the editor toolbar so the ✨ toggle stays clickable
function layoutAI() {
  if (!aiView || !win) return;
  const [w, h] = win.getContentSize();
  const pw = Math.min(420, Math.max(300, Math.round(w * 0.32)));
  aiView.setBounds({ x: w - pw, y: AI_TOP, width: pw, height: h - AI_TOP });
}
function ensureAI() {
  if (aiView) return;
  aiView = new WebContentsView({ webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.contentView.addChildView(aiView);
  layoutAI();
  aiView.webContents.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommandFor(projectDir) } });
}
function reloadAI() {
  if (aiView) aiView.webContents.loadFile('terminal.html', { query: { dir: projectDir, cmd: agentCommandFor(projectDir) } });
}
function showAI() { if (!projectDir) return; ensureAI(); aiVisible = true; aiView.setVisible(true); layoutAI(); }
function hideAI() { if (aiView) aiView.setVisible(false); aiVisible = false; }
function toggleAI() { aiVisible ? hideAI() : showAI(); }
function destroyAI() {
  if (aiView) { try { win.contentView.removeChildView(aiView); aiView.webContents.close(); } catch {} }
  aiView = null; aiVisible = false;
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

// ── Single-file HTML export ("text a file to a friend") ──────────────────────
// Inline a project's index.html into ONE self-contained .html. Pure Node (works
// on Windows, no bash/toolchain), so it's the friction-free way to share a game:
// no hosting, no app store, no Mac. It opens straight from Files/Safari on a
// phone. Ideal for already-bundled games (a Vite dist/ is one JS + one CSS);
// for multi-module source games it inlines what it can and warns about the rest.
const SF_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};
function sfReadLocal(dir, ref) {
  if (!ref || /^(https?:|data:|blob:|#|mailto:)/i.test(ref)) return null;
  const clean = ref.replace(/[?#].*$/, '').replace(/^\.?\//, '');
  const fp = path.resolve(dir, clean);
  if (fp !== dir && !fp.startsWith(dir + path.sep)) return null; // stay inside the project
  try { return fs.readFileSync(fp); } catch { return null; }
}
function sfDataUri(dir, ref) {
  const buf = sfReadLocal(dir, ref);
  if (!buf) return null;
  const ext = path.extname(ref.replace(/[?#].*$/, '')).toLowerCase();
  return `data:${SF_MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}
function sfInlineCssUrls(dir, css) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref) => {
    const u = sfDataUri(dir, ref);
    return u ? `url(${u})` : m;
  });
}
function buildSingleFile(dir) {
  dir = path.resolve(dir);
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const warnings = [];
  // modulepreload just prefetches the JS we're about to inline — drop it.
  html = html.replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/gi, '');
  // <link rel="stylesheet"> → <style> (with its url() assets inlined too)
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    const buf = sfReadLocal(dir, href);
    return buf ? `<style>\n${sfInlineCssUrls(dir, buf.toString('utf8'))}\n</style>` : tag;
  });
  // icon / apple-touch-icon links → data URI
  html = html.replace(/<link\b[^>]*\brel=["'][^"']*icon[^"']*["'][^>]*>/gi, (tag) => {
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    const u = sfDataUri(dir, href);
    return u ? tag.replace(href, u) : tag;
  });
  // <script src> → inline (keep type="module" etc.; drop crossorigin + src)
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, pre, src, post) => {
    const buf = sfReadLocal(dir, src);
    if (!buf) return tag;
    const attrs = `${pre} ${post}`.replace(/\bcrossorigin(=["'][^"']*["'])?/gi, '')
      .replace(/\ssrc=["'][^"']*["']/i, '').replace(/\s+/g, ' ').trim();
    let js = buf.toString('utf8');
    if (/\bfrom\s*["']\.{0,2}\//.test(js) || /\bimport\s*\(\s*["']\.{0,2}\//.test(js))
      warnings.push(`${src} still imports other local modules — a bundled build (e.g. Vite dist/) inlines cleanly; this one may not run standalone.`);
    js = js.replace(/<\/script>/gi, '<\\/script>'); // don't let the JS close the tag early
    return `<script${attrs ? ' ' + attrs : ''}>\n${js}\n</script>`;
  });
  // <img src> → data URI
  html = html.replace(/<img\b[^>]*?\ssrc=["']([^"']+)["'][^>]*>/gi, (tag, src) => {
    const u = sfDataUri(dir, src);
    return u ? tag.replace(src, u) : tag;
  });
  const external = [...new Set([...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]))];
  return { html, warnings, external };
}
async function exportSingleFile() {
  if (!projectDir) { dialog.showMessageBox(win, { message: 'Open a project first.' }); return; }
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    dialog.showMessageBox(win, { type: 'error', message: 'No index.html in this project.' }); return;
  }
  let result;
  try { result = buildSingleFile(projectDir); }
  catch (e) { dialog.showMessageBox(win, { type: 'error', message: 'Could not build the single file', detail: String(e) }); return; }

  const name = (path.basename(projectDir).replace(/[^a-z0-9_-]+/gi, '-') || 'game');
  const save = await dialog.showSaveDialog(win, {
    title: 'Save single-file game',
    defaultPath: path.join(app.getPath('desktop'), `${name}.html`),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (save.canceled || !save.filePath) return;
  fs.writeFileSync(save.filePath, result.html);

  const kb = Math.round(Buffer.byteLength(result.html) / 1024);
  let detail = `Saved ${kb} KB → ${save.filePath}\n\nText / AirDrop this one file. On iPhone: Save to Files → open it → Add to Home Screen.`;
  if (result.external.length) detail += `\n\n⚠ Still loads from the internet (won't work offline):\n${result.external.join('\n')}`;
  if (result.warnings.length) detail += `\n\nNote:\n${result.warnings.join('\n')}`;
  const r = dialog.showMessageBoxSync(win, {
    type: result.external.length || result.warnings.length ? 'warning' : 'info',
    message: 'Single-file export complete', detail, buttons: ['Reveal in Folder', 'OK'], defaultId: 1,
  });
  if (r === 0) shell.showItemInFolder(save.filePath);
}

// ── Publish to GitHub ────────────────────────────────────────────────────────
// Create a GitHub repo from the open project and push it — via the gh CLI, which
// owns auth so Capsule never handles tokens. Runs the git+gh steps in a terminal
// window (the native shell) so the user watches progress and sees any "run
// gh auth login" hint. The one-liner uses only && , || and ( ) grouping, which
// cmd.exe, zsh and bash all share — so no bash dependency on Windows.
async function publishToGitHub() {
  if (!projectDir) { dialog.showMessageBox(win, { message: 'Open a project first.' }); return; }
  const suggested = (path.basename(projectDir).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')) || 'my-game';
  const raw = await showPrompt('Name for the new GitHub repo:', suggested);
  if (!raw) return;
  const name = raw.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) { dialog.showMessageBox(win, { type: 'error', message: 'That name has no usable characters.' }); return; }
  const choice = dialog.showMessageBoxSync(win, {
    type: 'question', message: `Publish “${name}” to GitHub?`,
    detail: 'Creates the repo and pushes this project using the GitHub CLI (gh).\n\nNeeds gh installed and signed in — if it isn\'t, the terminal will tell you to run:  gh auth login',
    buttons: ['Private repo', 'Public repo', 'Cancel'], cancelId: 2, defaultId: 0,
  });
  if (choice === 2) return;
  const vis = choice === 0 ? 'private' : 'public';
  const cmd =
    'git init && git add -A && ' +
    '(git diff --cached --quiet || git commit -m "Initial commit") && ' +
    `gh repo create "${name}" --${vis} --source=. --remote=origin --push`;
  const w = new BrowserWindow({
    width: 840, height: 540, backgroundColor: '#0A0A0E',
    title: 'Capsule · Publish to GitHub',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  w.loadFile('terminal.html', { query: { dir: projectDir, cmd } });
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
  reloadAI();   // relaunch the docked AI box with the new agent
}

function openInVSCode() {
  if (!projectDir) return { ok: false, error: 'no project' };
  const dir = projectDir;
  const finder = () => shell.openPath(dir);   // last resort: reveal in the OS file manager
  if (process.platform === 'darwin') {
    // `open -a` works regardless of PATH (the packaged GUI app has a minimal PATH, so
    // spawning `code` directly fails with ENOENT). Fall back to the `code` CLI via a
    // login shell, then to Finder.
    const c = spawn('open', ['-a', 'Visual Studio Code', dir], { detached: true, stdio: 'ignore' });
    c.on('error', () => {
      const sh = spawn(process.env.SHELL || '/bin/zsh', ['-ilc', `code '${dir.replace(/'/g, "'\\''")}'`], { detached: true, stdio: 'ignore' });
      sh.on('error', finder); sh.unref();
    });
    c.unref();
    return { ok: true };
  }
  const child = spawn('code', [dir], { detached: true, stdio: 'ignore', shell: true });
  child.on('error', finder); child.unref();
  return { ok: true };
}

async function pickProject() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open a Capsule project', properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  await openProject(r.filePaths[0]);
  return r.filePaths[0];
}

// Import an existing project: copy it into the Capsule projects home (so it lives
// alongside everything else, like Unreal), then open the copy. The original is left
// untouched; node_modules / .git are skipped.
async function importProject() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import an existing project', buttonLabel: 'Import', properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  if (!isCapsule(src)) {
    dialog.showMessageBox(win, { type: 'warning', message: "That folder isn't a capsule", detail: 'It has no index.html or capsule.json.' });
    return null;
  }
  const name = path.basename(src);
  let dest = path.join(ensureProjectsRoot(), name), n = 2;
  while (fs.existsSync(dest)) dest = path.join(ensureProjectsRoot(), `${name}-${n++}`);
  try {
    fs.cpSync(src, dest, { recursive: true, filter: (s) => { const b = path.basename(s); return b !== 'node_modules' && b !== '.git'; } });
    await openProject(dest);
    return dest;
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Import failed', detail: String(e.message || e) });
    return null;
  }
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
ipcMain.handle('capsule:import', () => importProject());
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
ipcMain.handle('capsule:toggleAI', () => toggleAI());

// AI box terminal: the PTY runs HERE in the main process and streams to xterm in
// the renderer over IPC. A renderer can't create the Node Worker that node-pty's
// Windows ConPTY backend needs ("V8 platform ... does not support creating
// Workers"), so spawning the pty in the renderer fails on Windows. Main can.
const ptys = new Map();   // webContents -> pty process
ipcMain.handle('pty:spawn', (e, { dir, cmd, cols, rows } = {}) => {
  const wc = e.sender;
  const prev = ptys.get(wc); if (prev) { try { prev.kill(); } catch {} }
  const isWin = process.platform === 'win32';
  // Run inside the native interactive shell so the agent inherits the user's full
  // PATH/env/auth. Windows has no /bin/zsh or $SHELL — use its own shell.
  const shell = isWin ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/zsh');
  const args = isWin ? [] : ['-il'];
  let proc;
  try {
    proc = pty.spawn(shell, args, {
      name: 'xterm-color', cols: cols || 80, rows: rows || 24,
      cwd: dir || process.env.HOME || process.env.USERPROFILE, env: process.env,
    });
  } catch (err) {
    console.error('[capsule] pty:spawn FAILED:', err);
    throw err;
  }
  ptys.set(wc, proc);
  proc.onData((d) => { if (!wc.isDestroyed()) wc.send('pty:data', d); });
  proc.onExit(({ exitCode }) => { if (!wc.isDestroyed()) wc.send('pty:exit', exitCode); ptys.delete(wc); });
  // Launch the agent once the shell has initialised the user's environment.
  if (cmd) setTimeout(() => { try { proc.write(cmd + '\r'); } catch {} }, isWin ? 500 : 300);
  wc.once('destroyed', () => { const p = ptys.get(wc); if (p) { try { p.kill(); } catch {} } ptys.delete(wc); });
  return true;
});
ipcMain.on('pty:input', (e, d) => { const p = ptys.get(e.sender); if (p) { try { p.write(d); } catch {} } });
ipcMain.on('pty:resize', (e, { cols, rows } = {}) => { const p = ptys.get(e.sender); if (p) { try { p.resize(cols || 80, rows || 24); } catch {} } });
// "+ Add ▸ Asset" — pick a file and copy it into the project's assets/ (like a drag-drop).
ipcMain.handle('capsule:importAsset', async () => {
  if (!projectDir) return { ok: false, error: 'no project open' };
  const r = await dialog.showOpenDialog(win, {
    title: 'Import asset', buttonLabel: 'Import', properties: ['openFile'],
    filters: [{ name: 'Assets', extensions: ['glb', 'gltf', 'png', 'jpg', 'jpeg', 'webp', 'hdr', 'mp3', 'ogg', 'wav'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  const sub = /\.(glb|gltf)$/.test(ext) ? 'models' : /\.(png|jpe?g|webp|hdr)$/.test(ext) ? 'textures' : 'audio';
  const name = path.basename(src);
  const destDir = path.join(projectDir, 'assets', sub);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, name));
    return { ok: true, path: `assets/${sub}/${name}`, name };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── Mosaic — the visual moodboard ─────────────────────────────────────────────
// A per-project Milanote-style board for collecting visual direction (concept art,
// screenshots, storyboards). Everything is plain files: images land in `mosaic/<board>/`
// and the layout is a readable `mosaic.json` — so Claude can read the references the
// same way it reads the rest of the project. Opens in its own window.
const mosaicSlug = (s) => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'board');

function openMosaic(dir) {
  // Mosaic is strictly per-project. From the editor that's the open project; an explicit
  // `dir` targets that one. From the welcome screen (no project open) we pass NO dir, and
  // Mosaic shows its own project chooser ("open one of yours" / "new empty game") rather
  // than silently reusing the last project.
  const base = dir || projectDir || null;
  const query = base ? { query: { dir: base } } : {};
  if (mosaicWin && !mosaicWin.isDestroyed()) { mosaicWin.loadFile('mosaic.html', query); mosaicWin.focus(); return; }
  mosaicWin = new BrowserWindow({
    width: 1240, height: 820, backgroundColor: '#0A0A0E', title: 'Mosaic',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mosaicWin.loadFile('mosaic.html', query);
  mosaicWin.on('closed', () => { mosaicWin = null; });
}

// Copy a source image into a board folder, de-duplicating the filename on clash.
// Returns a project-relative `src` (mosaic/<board>/<file>) + the final name.
function mosaicCopyInto(base, boardId, srcPath) {
  const destDir = path.join(base, 'mosaic', boardId);
  fs.mkdirSync(destDir, { recursive: true });
  let name = path.basename(srcPath);
  if (fs.existsSync(path.join(destDir, name))) {
    const ext = path.extname(name), stem = name.slice(0, -ext.length || undefined);
    name = `${stem}-${Date.now().toString(36).slice(-4)}${ext}`;
  }
  fs.copyFileSync(srcPath, path.join(destDir, name));
  return { src: `mosaic/${boardId}/${name}`, name };
}

ipcMain.handle('mosaic:open', () => openMosaic());
ipcMain.handle('mosaic:openExternal', (e, url) => { if (url) shell.openExternal(url); });
// Project chooser (shown when Mosaic opens with no project) + design-first creation.
ipcMain.handle('mosaic:projects', () => ({ root: ensureProjectsRoot(), projects: listProjects() }));
ipcMain.handle('mosaic:createProject', (e, opts) => createProject({ ...(opts || {}), open: false }));
ipcMain.handle('mosaic:load', (e, dir) => {
  const base = dir || projectDir; if (!base) return { boards: [] };
  try { return JSON.parse(fs.readFileSync(path.join(base, 'mosaic.json'), 'utf8')); }
  catch { return { boards: [] }; }
});
ipcMain.handle('mosaic:save', (e, { dir, data }) => {
  const base = dir || projectDir; if (!base) return { ok: false };
  try { fs.mkdirSync(path.join(base, 'mosaic'), { recursive: true });
    fs.writeFileSync(path.join(base, 'mosaic.json'), JSON.stringify(data, null, 2)); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('mosaic:newBoard', (e, { dir, name }) => {
  const base = dir || projectDir;
  const data = (() => { try { return JSON.parse(fs.readFileSync(path.join(base, 'mosaic.json'), 'utf8')); } catch { return { boards: [] }; } })();
  let id = mosaicSlug(name), n = 1;
  while ((data.boards || []).some((b) => b.id === id)) id = mosaicSlug(name) + '-' + (++n);
  fs.mkdirSync(path.join(base, 'mosaic', id), { recursive: true });
  return { id };
});
ipcMain.handle('mosaic:importImages', async (e, { dir, boardId }) => {
  const base = dir || projectDir; if (!base) return { canceled: true };
  const r = await dialog.showOpenDialog(mosaicWin || win, {
    title: 'Add images', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { files: r.filePaths.map((fp) => mosaicCopyInto(base, boardId, fp)) };
});
ipcMain.handle('mosaic:addDroppedFile', (e, { dir, boardId, filePath }) => {
  const base = dir || projectDir; if (!base || !filePath) return null;
  try { return mosaicCopyInto(base, boardId, filePath); } catch { return null; }
});
// Point the docked AI box at a board: dock + focus the editor's chat and TYPE a
// reference prompt into the live agent (no newline — the user finishes the sentence).
ipcMain.handle('mosaic:referenceInAI', async (e, { dir, boardId, files }) => {
  const base = dir || projectDir;
  if (!base || !win) return { ok: false };
  // If this board's game isn't the one open in the editor (e.g. a design-first board),
  // open it so it has a live AI box — bridging "designed it" → "now build it".
  const wasOpen = projectDir === base;
  if (!wasOpen) await openProject(base);
  ensureAI(); showAI();
  const list = (files && files.length) ? ' (' + files.slice(0, 12).join(', ') + (files.length > 12 ? ', …' : '') + ')' : '';
  const text = `Take a look at the reference images in ./mosaic/${boardId}/${list} and `;
  const send = () => { if (aiView) aiView.webContents.send('capsule:inject', text); win.focus(); };
  // A freshly-opened project needs a moment for the AI box's pty + agent to come up.
  wasOpen ? send() : setTimeout(send, 1500);
  return { ok: true };
});

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
      { label: 'AI Box (toggle)', accelerator: 'CmdOrCtrl+J', click: () => toggleAI() },
      { label: 'Set AI Agent…', click: () => chooseAgent() },
      { label: 'Open Mosaic (moodboard)', accelerator: 'CmdOrCtrl+Shift+M', click: () => openMosaic() },
      { label: 'Open in VS Code', accelerator: 'CmdOrCtrl+Shift+C', click: () => openInVSCode() },
      { type: 'separator' },
      { label: 'Export', submenu: [
        { label: 'Single-file HTML — text to a friend…', click: () => exportSingleFile() },
        { type: 'separator' },
        { label: 'Desktop App (this OS)…', click: () => exportGame(process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux') },
        { label: 'Desktop App — all platforms…', click: () => exportGame('all') },
        { label: 'Mobile app project (iOS + Android)…', click: () => exportGame('both', true) },
      ] },
      { label: 'Publish to GitHub…', click: () => publishToGitHub() },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
    ] },
    { label: 'Preview', submenu: [
      { label: 'Fit to window', accelerator: 'CmdOrCtrl+1', click: () => previewDevice(null) },
      { label: 'Phone — 390 × 844', accelerator: 'CmdOrCtrl+2', click: () => previewDevice('phone') },
      { label: 'Tablet — 820 × 1180', accelerator: 'CmdOrCtrl+3', click: () => previewDevice('tablet') },
      { type: 'separator' },
      { label: 'Fit window to editor', click: () => { if (win) { win.setContentSize(1360, 860); win.center(); } } },
    ] },
    { role: 'viewMenu' }, { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#0A0A0E', title: 'Capsule',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
  });
  win.on('resize', layoutAI);   // keep the docked AI panel sized to the window
  win.on('closed', () => { aiView = null; aiVisible = false; });   // window gone → its child views are too
  // In Play mode (a served project page without ?edit) the editor overlay isn't loaded,
  // so inject a visible way back to the editor.
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    const isProject = /^http:\/\/127\.0\.0\.1/.test(url);
    const isEdit = /[?&]edit\b/.test(url);
    // Edit mode: if the page didn't bring its own editor (a three.js capsule
    // imports capsule-edit.js and sets window.capsule.editor), inject the DOM
    // overlay so reference pins + LOOK work on ANY html/canvas game — including
    // imported ones — with no per-game code. Poll briefly first so a real editor
    // that's still loading wins; three.js capsules are therefore never touched.
    if (isProject && isEdit) {
      let tries = 0;
      const check = async () => {
        try {
          if (await win.webContents.executeJavaScript('!!(window.capsule && window.capsule.editor)')) return;
          if (++tries >= 4) {
            const dom = fs.readFileSync(path.join(__dirname, 'template', 'capsule-edit-dom.js'), 'utf8');
            return void win.webContents.executeJavaScript(dom);
          }
          setTimeout(check, 400);
        } catch { /* navigated away */ }
      };
      setTimeout(check, 400);
      return;
    }
    if (!isProject) return;
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
      bar.appendChild(mk('▦ Mosaic', () => host.openMosaic && host.openMosaic()));
      bar.appendChild(mk('</> Code', () => host.openInVSCode && host.openInVSCode()));
      bar.appendChild(mk('⌂ Welcome', () => host.welcome && host.welcome()));
      document.body.appendChild(bar);
    })();`).catch(() => {});

    // Mobile projects: frame the running preview to a phone too (matches the editor). Self-contained
    // — no overlay in Play mode, so this drives window.capsule's renderer/camera directly.
    if (readMeta(projectDir || '').platform === 'mobile') {
      win.webContents.executeJavaScript(`(() => {
        if (window.__capMobileFrame) return; window.__capMobileFrame = 1;
        const W = 390, H = 844;
        const ready = () => window.capsule && window.capsule.renderer && window.capsule.camera && window.capsule.renderer.domElement;
        const start = () => {
          const cap = window.capsule, cv = cap.renderer.domElement, orig = cap.renderer.setSize.bind(cap.renderer);
          let frame = null;
          const lb = document.createElement('div');
          lb.style.cssText = 'position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(130% 130% at 50% 28%,#0c0c11,#050506)';
          document.body.appendChild(lb);
          const box = () => { const pad = 24, aw = Math.max(140, innerWidth - pad*2), ah = Math.max(140, innerHeight - pad*2), s = Math.min(aw/W, ah/H); return { w: Math.round(W*s), h: Math.round(H*s) }; };
          const place = () => { const b = box(); frame = b; cv.style.position='fixed'; cv.style.zIndex='2';
            cv.style.left = Math.round((innerWidth-b.w)/2)+'px'; cv.style.top = Math.round((innerHeight-b.h)/2)+'px';
            cv.style.width = b.w+'px'; cv.style.height = b.h+'px'; cv.style.borderRadius='22px';
            cv.style.boxShadow = '0 0 0 2px rgba(255,255,255,.10),0 0 0 10px #050506,0 40px 90px rgba(0,0,0,.6)';
            orig(b.w, b.h, false); if (cap.camera.isPerspectiveCamera) { cap.camera.aspect = W/H; cap.camera.updateProjectionMatrix(); } };
          cap.renderer.setSize = (w,h,u) => { if (frame) orig(frame.w, frame.h, false); else orig(w,h,u); };
          addEventListener('resize', place); place();
          (function g(){ if (cap.camera.isPerspectiveCamera){ const a = W/H; if (Math.abs(cap.camera.aspect-a) > 1e-4) { cap.camera.aspect = a; cap.camera.updateProjectionMatrix(); } } requestAnimationFrame(g); })();
        };
        (function wait(){ if (ready()) start(); else setTimeout(wait, 120); })();
      })();`).catch(() => {});
    }
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
  // Clicking the dock icon after the window was closed: recreate it on the welcome
  // screen (createWindow alone leaves a blank window with nothing loaded).
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); showWelcome(); } });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
