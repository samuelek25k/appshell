// Preload for the host UI (trusted, but still sandboxed and isolated).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  open: (appId) => ipcRenderer.invoke('host:open', String(appId)),
  home: () => ipcRenderer.invoke('host:home'),
  back: () => ipcRenderer.invoke('host:back'),
  close: () => ipcRenderer.invoke('host:close'),
  refreshCatalog: () => ipcRenderer.invoke('host:refreshCatalog'),
  install: (appId) => ipcRenderer.invoke('host:install', String(appId)),
  rollback: (appId) => ipcRenderer.invoke('host:rollback', String(appId)),
  dismissInstall: () => ipcRenderer.invoke('host:dismissInstall'),
  uninstall: (appId) => ipcRenderer.invoke('host:uninstall', String(appId)),
  widgetAction: (appId, widgetId, actionId) => ipcRenderer.invoke('host:widgetAction', String(appId), String(widgetId), String(actionId)),
  onState(fn) {
    ipcRenderer.on('host:state', (_event, state) => fn(state));
    ipcRenderer.invoke('host:ready');
  },
});
