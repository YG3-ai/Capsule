// Capsule MCP server — exposes the live editor to Claude as tools.
//
// Runs inside the app's main process, so each tool just drives the editor by
// executing JS against the window main already controls (window.capsule.editor),
// plus capturePage() for screenshots. Claude Code connects over HTTP (see the
// .mcp.json snippet in RUN_COMMAND.md / printed on launch).

const http = require('http');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');

const MCP_PORT = 39127;   // fixed so .mcp.json can point at it

function makeServer(getWindow) {
  const win = () => getWindow();
  const execJS = async (code) => {
    const w = win();
    if (!w || w.isDestroyed()) throw new Error('Capsule has no project open');
    return w.webContents.executeJavaScript(code, true);
  };
  const ready = async () => {
    const ok = await execJS('!!(window.capsule && window.capsule.editor)').catch(() => false);
    if (!ok) throw new Error('Editor not attached — open a project in edit mode (?edit) first.');
  };
  const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

  const server = new McpServer({ name: 'capsule-editor', version: '0.1.0' });

  server.registerTool('list_editables',
    { description: 'List every editable object in the open scene: id, type, position, rotation (deg), scale.' },
    async () => { await ready(); return text(await execJS('JSON.stringify(window.capsule.editor.list())')); });

  server.registerTool('get_selection',
    { description: 'Get the id of the currently selected object, or null.' },
    async () => { await ready(); return text(await execJS('window.capsule.editor.selected ? window.capsule.editor.selected.userData.capsuleId : null')); });

  server.registerTool('select',
    { description: 'Select an object by id and fly the camera to it.', inputSchema: { id: z.string() } },
    async ({ id }) => { await ready(); await execJS(`window.capsule.editor.selectById(${JSON.stringify(id)})`); return text('selected ' + id); });

  server.registerTool('move',
    { description: "Set an object's transform (undoable). position & scale in world units, rotation in degrees. Omit any field to leave it unchanged.",
      inputSchema: { id: z.string(), position: z.array(z.number()).length(3).optional(), rotation: z.array(z.number()).length(3).optional(), scale: z.array(z.number()).length(3).optional() } },
    async ({ id, position, rotation, scale }) => {
      await ready();
      const t = JSON.stringify({ position, rotation, scale });
      const ok = await execJS(`window.capsule.editor.setTransform(${JSON.stringify(id)}, ${t})`);
      return text(ok ? `moved ${id}` : `no editable with id "${id}"`);
    });

  server.registerTool('set_layer',
    { description: 'Switch the editor to a scene state/layer (e.g. base, loop0, loop3).', inputSchema: { layer: z.string() } },
    async ({ layer }) => { await ready(); await execJS(`window.capsule.editor.setLayer(${JSON.stringify(layer)})`); return text('layer = ' + layer); });

  server.registerTool('save',
    { description: 'Save placements to capsule.scenes.json.' },
    async () => { await ready(); await execJS('window.capsule.editor.save()'); return text('saved'); });

  server.registerTool('screenshot',
    { description: 'Capture the editor viewport as a PNG so you can see the current scene.' },
    async () => {
      const w = win(); if (!w || w.isDestroyed()) throw new Error('Capsule has no project open');
      const img = await w.webContents.capturePage();
      return { content: [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }] };
    });

  return server;
}

// Stateful Streamable-HTTP (the standard pattern for a server a client connects to):
// `initialize` mints a session id, subsequent calls reuse it.
function startMcp(getWindow) {
  const transports = {};   // sessionId -> transport

  const httpServer = http.createServer((req, res) => {
    if (!req.url.startsWith('/mcp')) { res.writeHead(404); return res.end(); }
    const sid = req.headers['mcp-session-id'];

    // SSE stream / session teardown reuse the existing transport.
    if (req.method === 'GET' || req.method === 'DELETE') {
      const t = sid && transports[sid];
      if (!t) { res.writeHead(400); return res.end('Unknown session'); }
      t.handleRequest(req, res);
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let parsed; try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }
      let transport = sid && transports[sid];
      if (!transport && isInitializeRequest(parsed)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => { transports[id] = transport; },
        });
        transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
        await makeServer(getWindow).connect(transport);
      }
      if (!transport) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No session — send initialize first' } }));
      }
      try { await transport.handleRequest(req, res, parsed); }
      catch (e) { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String((e && e.message) || e) } })); } }
    });
  });
  httpServer.on('error', (e) => console.error('[capsule] MCP server error:', e.message));
  httpServer.listen(MCP_PORT, '127.0.0.1', () => console.log(`[capsule] MCP server → http://127.0.0.1:${MCP_PORT}/mcp`));
  return httpServer;
}

module.exports = { startMcp, MCP_PORT };
