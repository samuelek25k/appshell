const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  sandboxed: Boolean(process.sandboxed),
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
  setTheme: (theme) => ipcRenderer.invoke('host:setTheme', String(theme)),
  setLocale: (locale) => ipcRenderer.invoke('host:setLocale', String(locale)),
  switchAccount: (id, pin) => ipcRenderer.invoke('host:accounts:switch', String(id), pin === undefined ? undefined : String(pin)),
  startGuest: () => ipcRenderer.invoke('host:accounts:guest'),
  addAccount: (name, pin) => ipcRenderer.invoke('host:accounts:add', String(name), pin === undefined || pin === '' ? undefined : String(pin)),
  removeAccount: (id, pin) => ipcRenderer.invoke('host:accounts:remove', String(id), pin === undefined ? undefined : String(pin)),
  onState(fn) {
    ipcRenderer.on('host:state', (_event, state) => fn(state));
    ipcRenderer.invoke('host:ready');
  },
});
