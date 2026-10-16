const { contextBridge, ipcRenderer } = require('electron');

/** @type {Map<string, Set<(payload: unknown) => void>>} */
const listeners = new Map();
ipcRenderer.on('appshell:event', (_event, name, payload) => {
  for (const fn of listeners.get(name) ?? []) fn(payload);
});

contextBridge.exposeInMainWorld('appshell', {
  sandboxed: Boolean(process.sandboxed),
  async call(method, params) {
    const reply = await ipcRenderer.invoke('appshell:call', String(method), params ?? {});
    if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
    return reply.result;
  },
  on(name, fn) {
    if (typeof fn !== 'function') return () => {};
    const set = listeners.get(name) ?? new Set();
    set.add(fn);
    listeners.set(name, set);
    return () => set.delete(fn);
  },
});
