// Electron main process — the Capsule native shell.
//
// It serves the bundled capsule from a tiny localhost HTTP server (Node's built-in
// `http`, no dependencies) and points the window at http://127.0.0.1:<port>/.
//
// Why a real server instead of file:// or a custom protocol: capsules use ES modules
// + an importmap + fetch(). The browser blocks all of those on file://, and Chromium
// refuses to load ES module scripts over Electron custom protocols (fetch works, but
// `import` fails). A localhost HTTP origin behaves exactly like the dev server, so the
// game runs unchanged. The socket binds to 127.0.0.1 only — nothing is exposed.

const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'image/vnd.radiance', '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { res.writeHead(400); return res.end('Bad request'); }
      if (rel === '/' || rel === '') rel = '/index.html';
      const filePath = path.normalize(path.join(ROOT, rel));
      // Block path traversal outside the app directory.
      if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403); return res.end('Forbidden');
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    title: app.getName(),
    autoHideMenuBar: true,
    webPreferences: {
      // The renderer runs only our own local game code; it needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(`http://127.0.0.1:${port}/index.html`);
}

app.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
