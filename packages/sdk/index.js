const bridge = /** @type {any} */ (globalThis).appshell;

export const call = (/** @type {string} */ method, /** @type {object} */ params = {}) => bridge.call(method, params);

export const shell = {
  hello: () => call('shell.hello'),
  setTitle: (/** @type {string} */ title) => call('shell.setTitle', { title }),
  getLocale: () => call('shell.getLocale'),
  onLocaleChanged: (/** @type {(locale: { locale: string, direction: 'ltr' | 'rtl', timeZone: string, languages: string[] }) => void} */ fn) =>
    bridge.on('shell.localeChanged', fn),
  onCloseRequested: (/** @type {() => boolean | Promise<boolean>} */ fn) =>
    bridge.on('shell.closeRequested', async (/** @type {{ nonce: string }} */ { nonce }) =>
      call('shell.closeResponse', { nonce, allow: (await fn()) !== false })),
  onDeepLink: (/** @type {(link: { path: string }) => void} */ fn) => bridge.on('shell.deepLink', fn),
};

export const storage = {
  get: (/** @type {string} */ key) => call('storage.get', { key }),
  set: (/** @type {string} */ key, /** @type {unknown} */ value) => call('storage.set', { key, value }),
  remove: (/** @type {string} */ key) => call('storage.remove', { key }),
  onChange: (/** @type {(change: { key: string, value: unknown }) => void} */ fn) => bridge.on('storage.changed', fn),
};

export const secrets = {
  get: (/** @type {string} */ name) => call('secrets.get', { name }),
  set: (/** @type {string} */ name, /** @type {string} */ value) => call('secrets.set', { name, value }),
};

export const notifications = {
  show: (/** @type {string} */ title, /** @type {string} */ body) => call('notifications.show', { title, body }),
};

export const log = (/** @type {'debug' | 'info' | 'warn' | 'error'} */ level, /** @type {string} */ message) =>
  call('log.write', { level, message });

export const widgets = {
  update: (/** @type {string} */ id, /** @type {{ blocks: object[] }} */ descriptor) => call('widgets.update', { id, descriptor }),
  onAction: (/** @type {(e: { widget: string, action: string }) => void} */ fn) => bridge.on('widgets.action', fn),
};

export const identity = {
  token: () => call('identity.token'),
  publicKey: () => call('identity.publicKey'),
};

export const backend = {
  call: (/** @type {string} */ method, /** @type {object} */ params = {}) => call('backend.call', { method, params }),
};
