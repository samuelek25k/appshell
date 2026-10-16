const bridge = /** @type {any} */ (globalThis).appshell;

export const call = (/** @type {string} */ method, /** @type {object} */ params = {}) => bridge.call(method, params);

export const shell = {
  hello: () => call('shell.hello'),
  setTitle: (/** @type {string} */ title) => call('shell.setTitle', { title }),
  getLocale: () => call('shell.getLocale'),
  onLocaleChanged: (/** @type {(locale: { locale: string, direction: 'ltr' | 'rtl', timeZone: string, languages: string[] }) => void} */ fn) =>
    bridge.on('shell.localeChanged', fn),
  getTheme: () => call('shell.getTheme'),
  onThemeChanged: (/** @type {(theme: { source: 'system' | 'light' | 'dark', dark: boolean }) => void} */ fn) =>
    bridge.on('shell.themeChanged', fn),
  getVersions: () => call('shell.getVersions'),
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

export const iac = {
  /**
   * @param {string} to
   * @param {string} action
   * @param {unknown} [payload]
   * @param {{ launchIfNeeded?: boolean }} [options]
   * @returns {Promise<{ delivered: boolean, targetRunning: boolean }>}
   */
  send: (to, action, payload, options = {}) =>
    call('iac.send', { to, action, payload, launchIfNeeded: options.launchIfNeeded }),

  /**
   * @param {string} channel
   * @param {unknown} data
   * @returns {Promise<{ subscribersCount: number }>}
   */
  publish: (channel, data) => call('iac.publish', { channel, data }),

  /**
   * @param {string} channel
   * @returns {Promise<{ channel: string, subscribed: boolean }>}
   */
  subscribe: (channel) => call('iac.subscribe', { channel }),

  /**
   * @param {string} channel
   * @returns {Promise<{ channel: string, unsubscribed: boolean }>}
   */
  unsubscribe: (channel) => call('iac.unsubscribe', { channel }),

  /**
   * @param {(msg: { from: string, action: string, payload: unknown, timestamp: number }) => void} fn
   */
  onMessage: (fn) => bridge.on('iac.message', fn),

  /**
   * @param {(msg: { channel: string, from: string, data: unknown, timestamp: number }) => void} fn
   */
  onBroadcast: (fn) => bridge.on('iac.broadcast', fn),
};

export const browser = {
  /**
   * @param {string} url
   * @returns {Promise<{ url: string, title: string }>}
   */
  navigate: (url) => call('browser.navigate', { url }),

  /**
   * @param {{ action: 'click' | 'type' | 'press' | 'select', selector: string, value?: string }} params
   * @returns {Promise<{ action: string, selector: string, success: boolean }>}
   */
  act: (params) => call('browser.act', params),

  /**
   * @param {{ selector?: string, format?: 'text' | 'html' }} [params]
   * @returns {Promise<{ value: string | null }>}
   */
  extract: (params = {}) => call('browser.extract', params),

  /**
   * @param {string} script
   * @returns {Promise<{ result: unknown }>}
   */
  evaluate: (script) => call('browser.evaluate', { script }),

  /**
   * @returns {Promise<{ dataUrl: string }>}
   */
  screenshot: () => call('browser.screenshot'),

  /**
   * @returns {Promise<{ active: boolean, url: string | null, title: string | null, loading: boolean }>}
   */
  status: () => call('browser.status'),

  /**
   * @returns {Promise<{ closed: boolean }>}
   */
  close: () => call('browser.close'),

  /**
   * @param {(info: { url: string, title: string }) => void} fn
   */
  onNavigated: (fn) => bridge.on('browser.navigated', fn),
};

