// Appshell app SDK. The host serves this file to every app at /__appshell/sdk.js,
// so it always matches the running host:  import { storage } from '/__appshell/sdk.js';
const bridge = /** @type {any} */ (globalThis).appshell;

/** Calls a bridge method. Rejects with an Error whose message starts with the error code. */
export const call = (/** @type {string} */ method, /** @type {object} */ params = {}) => bridge.call(method, params);

export const shell = {
  hello: () => call('shell.hello'),
  setTitle: (/** @type {string} */ title) => call('shell.setTitle', { title }),
  /** Return false (or a promise of false) to keep the app open. The host waits 600 ms. */
  onCloseRequested: (/** @type {() => boolean | Promise<boolean>} */ fn) =>
    bridge.on('shell.closeRequested', async (/** @type {{ nonce: string }} */ { nonce }) =>
      call('shell.closeResponse', { nonce, allow: (await fn()) !== false })),
  onDeepLink: (/** @type {(link: { path: string }) => void} */ fn) => bridge.on('shell.deepLink', fn),
};

export const storage = {
  get: (/** @type {string} */ key) => call('storage.get', { key }),
  set: (/** @type {string} */ key, /** @type {unknown} */ value) => call('storage.set', { key, value }),
  remove: (/** @type {string} */ key) => call('storage.remove', { key }),
};

export const secrets = {
  get: (/** @type {string} */ name) => call('secrets.get', { name }),
  set: (/** @type {string} */ name, /** @type {string} */ value) => call('secrets.set', { name, value }),
};

export const notifications = {
  show: (/** @type {string} */ title, /** @type {string} [body] */ body) => call('notifications.show', { title, body }),
};

export const log = (/** @type {'debug' | 'info' | 'warn' | 'error'} */ level, /** @type {string} */ message) =>
  call('log.write', { level, message });

export const widgets = {
  update: (/** @type {string} */ id, /** @type {{ blocks: object[] }} */ descriptor) => call('widgets.update', { id, descriptor }),
  onAction: (/** @type {(e: { widget: string, action: string }) => void} */ fn) => bridge.on('widgets.action', fn),
};

export const backend = {
  call: (/** @type {string} */ method, /** @type {object} */ params = {}) => call('backend.call', { method, params }),
};
