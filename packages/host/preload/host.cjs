// Preload for the host UI (trusted, but still sandboxed and isolated).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  open: (appId) => ipcRenderer.invoke('host:open', String(appId)),
  home: () => ipcRenderer.invoke('host:home'),
  back: () => ipcRenderer.invoke('host:back'),
  close: () => ipcRenderer.invoke('host:close'),
  widgetAction: (appId, widgetId, actionId) => ipcRenderer.invoke('host:widgetAction', String(appId), String(widgetId), String(actionId)),
  onState(fn) {
    ipcRenderer.on('host:state', (_event, state) => fn(state));
    ipcRenderer.invoke('host:ready');
  },
});
