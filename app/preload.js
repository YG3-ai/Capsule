// Preload — the only bridge between the game/editor (renderer) and the OS.
// Exposes a tiny, safe `capsuleHost` API. Its presence is how the editor overlay
// knows it's running inside the Capsule app (and can save straight to disk).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capsuleHost', {
  isCapsuleApp: true,
  // Save scene data to the open project folder — the location is already known,
  // so there's no picker. Returns { ok, path } or { ok:false, error }.
  saveScenes: (json, name = 'capsule.scenes.json') => ipcRenderer.invoke('capsule:save', { json, name }),
  // Write a dropped asset (ArrayBuffer) into the project's assets/models/. Returns { ok, path }.
  saveAsset: (name, buffer) => ipcRenderer.invoke('capsule:saveAsset', { name, buffer }),
  openInVSCode: () => ipcRenderer.invoke('capsule:code'),
  pickProject: () => ipcRenderer.invoke('capsule:pick'),
  importProject: () => ipcRenderer.invoke('capsule:import'),   // copy into the Capsule folder, then open

  newProject: () => ipcRenderer.invoke('capsule:new'),
  recents: () => ipcRenderer.invoke('capsule:recents'),
  openPath: (p) => ipcRenderer.invoke('capsule:openPath', p),
  // screens + project lifecycle
  welcome: () => ipcRenderer.invoke('capsule:welcome'),
  browse: () => ipcRenderer.invoke('capsule:browse'),
  newScreen: () => ipcRenderer.invoke('capsule:newScreen'),
  projects: () => ipcRenderer.invoke('capsule:projects'),         // { root, projects[], recents[] }
  createProject: (opts) => ipcRenderer.invoke('capsule:create', opts), // { name, kind, platform }
  revealProjects: () => ipcRenderer.invoke('capsule:revealProjects'),
  // viewport + export
  setViewport: (w, h) => ipcRenderer.invoke('capsule:viewport', { w, h }),
  exportGame: (target, mobile) => ipcRenderer.invoke('capsule:export', { target, mobile }),
  // assets + AI box
  importAsset: () => ipcRenderer.invoke('capsule:importAsset'),   // { ok, path, name } or { canceled }
  toggleAI: () => ipcRenderer.invoke('capsule:toggleAI'),
  openMosaic: () => ipcRenderer.invoke('mosaic:open'),            // visual moodboard window
});
