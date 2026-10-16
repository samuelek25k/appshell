import { readFileSync } from 'node:fs';
import AjvModule from 'ajv';

const Ajv = AjvModule.default;

const load = (/** @type {string} */ name) =>
  JSON.parse(readFileSync(new URL(`./schemas/${name}.schema.json`, import.meta.url), 'utf8'));

const ajv = new Ajv({ allErrors: true, useDefaults: true, allowUnionTypes: true });
const validators = {
  manifest: ajv.compile(load('manifest')),
  product: ajv.compile(load('product')),
  widget: ajv.compile(load('widget')),
  catalog: ajv.compile(load('catalog')),
};

/**
 * @param {'manifest' | 'product' | 'widget' | 'catalog'} kind
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validate(kind, value) {
  const check = validators[kind];
  if (check(value)) return { ok: true };
  return { ok: false, errors: (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

export const SHELL_PROTOCOL = 1;

export const CLOSE_VETO_TIMEOUT_MS = 600;

export const ERRORS = /** @type {const} */ ({
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  INVALID_PARAMS: 'INVALID_PARAMS',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  BACKEND_TIMEOUT: 'BACKEND_TIMEOUT',
  BACKEND_ERROR: 'BACKEND_ERROR',
});

/**
 * @typedef {{
 *   id: string, version: string, title: string, publisher: string,
 *   engines: { appshell: string },
 *   entry: { ui?: string, backend?: string },
 *   display?: 'shell' | 'standalone',
 *   widgets?: { id: string, title: string }[],
 *   capabilities?: { network?: string[], notifications?: boolean, secrets?: string[], identity?: boolean, iac?: boolean | { send?: string[], receive?: string[], channels?: string[] }, browser?: boolean | { allowedDomains?: string[] } }
 * }} Manifest
 */

const str = (/** @type {unknown} */ v, max = 1000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const key = (/** @type {unknown} */ v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v);

/**
 * @param {Manifest} m
 * @param {string} [url]
 */
export function checkBrowserCapability(m, url) {
  const browser = m.capabilities?.browser;
  if (!browser) return 'browser';
  if (browser === true) return null;
  if (typeof browser === 'object') {
    if (!url || !browser.allowedDomains || browser.allowedDomains.length === 0) return null;
    let u;
    try { u = new URL(url); } catch { return 'browser:invalid_url'; }
    const host = u.hostname.toLowerCase();
    const allowed = browser.allowedDomains.some((d) => {
      const pattern = d.toLowerCase();
      return host === pattern || host.endsWith('.' + pattern);
    });
    return allowed ? null : `browser:domain:${host}`;
  }
  return 'browser';
}

/**
 * @param {Manifest} m
 * @param {string} targetId
 */
function checkIacSend(m, targetId) {
  const iac = m.capabilities?.iac;
  if (!iac) return 'iac';
  if (iac === true) return null;
  if (typeof iac === 'object') {
    if (!iac.send || iac.send.includes('*') || iac.send.includes(targetId)) return null;
    return `iac:send:${targetId}`;
  }
  return 'iac';
}

/**
 * @param {Manifest} m
 * @param {string} channel
 */
function checkIacChannel(m, channel) {
  const iac = m.capabilities?.iac;
  if (!iac) return 'iac';
  if (iac === true) return null;
  if (typeof iac === 'object') {
    if (!iac.channels || iac.channels.includes('*') || iac.channels.includes(channel)) return null;
    return `iac:channel:${channel}`;
  }
  return 'iac';
}

/**
 * @param {Manifest} m
 * @param {string} senderId
 */
export function allowsIacReceive(m, senderId) {
  const iac = m.capabilities?.iac;
  if (!iac) return false;
  if (iac === true) return true;
  if (typeof iac === 'object') {
    return !iac.receive || iac.receive.includes('*') || iac.receive.includes(senderId);
  }
  return false;
}

/**
 * @type {Record<string, { params: (p: any) => boolean, requires: (m: Manifest, p: any) => string | null }>}
 */
export const METHODS = {
  'shell.hello': { params: () => true, requires: () => null },
  'shell.setTitle': { params: (p) => str(p?.title, 60), requires: () => null },
  'shell.closeResponse': { params: (p) => str(p?.nonce, 64) && typeof p?.allow === 'boolean', requires: () => null },
  'shell.getLocale': { params: () => true, requires: () => null },
  'shell.getTheme': { params: () => true, requires: () => null },
  'shell.getVersions': { params: () => true, requires: () => null },
  'widgets.update': {
    params: (p) => str(p?.id, 32) && typeof p?.descriptor === 'object' && p.descriptor !== null,
    requires: (m, p) => (m.widgets ?? []).some((w) => w.id === p.id) ? null : `widgets:${p.id}`,
  },
  'storage.get': { params: (p) => key(p?.key), requires: () => null },
  'storage.set': { params: (p) => key(p?.key) && p.value !== undefined, requires: () => null },
  'storage.remove': { params: (p) => key(p?.key), requires: () => null },
  'secrets.get': {
    params: (p) => key(p?.name),
    requires: (m, p) => (m.capabilities?.secrets ?? []).includes(p.name) ? null : `secrets:${p.name}`,
  },
  'secrets.set': {
    params: (p) => key(p?.name) && str(p?.value, 4096),
    requires: (m, p) => (m.capabilities?.secrets ?? []).includes(p.name) ? null : `secrets:${p.name}`,
  },
  'notifications.show': {
    params: (p) => str(p?.title, 80) && (p.body === undefined || str(p.body, 280)),
    requires: (m) => (m.capabilities?.notifications ? null : 'notifications'),
  },
  'log.write': {
    params: (p) => ['debug', 'info', 'warn', 'error'].includes(p?.level) && str(p?.message, 2000),
    requires: () => null,
  },
  'backend.call': { params: (p) => str(p?.method, 64), requires: (m) => (m.entry.backend ? null : 'backend') },
  'identity.token': { params: () => true, requires: (m) => (m.capabilities?.identity ? null : 'identity') },
  'identity.publicKey': { params: () => true, requires: () => null },
  'iac.send': {
    params: (p) => str(p?.to, 64) && str(p?.action, 64) && (p?.payload === undefined || typeof p.payload === 'object' || typeof p.payload === 'string' || typeof p.payload === 'number' || typeof p.payload === 'boolean') && (p?.launchIfNeeded === undefined || typeof p.launchIfNeeded === 'boolean'),
    requires: (m, p) => checkIacSend(m, p.to),
  },
  'iac.publish': {
    params: (p) => key(p?.channel) && p?.data !== undefined,
    requires: (m, p) => checkIacChannel(m, p.channel),
  },
  'iac.subscribe': {
    params: (p) => key(p?.channel),
    requires: (m, p) => checkIacChannel(m, p.channel),
  },
  'iac.unsubscribe': {
    params: (p) => key(p?.channel),
    requires: (m, p) => checkIacChannel(m, p.channel),
  },
  'browser.navigate': {
    params: (p) => str(p?.url, 2048),
    requires: (m, p) => checkBrowserCapability(m, p?.url),
  },
  'browser.act': {
    params: (p) => ['click', 'type', 'press', 'select'].includes(p?.action) && str(p?.selector, 500) && (p?.value === undefined || typeof p?.value === 'string'),
    requires: (m) => checkBrowserCapability(m),
  },
  'browser.extract': {
    params: (p) => (p?.selector === undefined || str(p?.selector, 500)) && (p?.format === undefined || ['text', 'html'].includes(p?.format)),
    requires: (m) => checkBrowserCapability(m),
  },
  'browser.evaluate': {
    params: (p) => str(p?.script, 10000),
    requires: (m) => checkBrowserCapability(m),
  },
  'browser.screenshot': {
    params: () => true,
    requires: (m) => checkBrowserCapability(m),
  },
  'browser.status': {
    params: () => true,
    requires: (m) => checkBrowserCapability(m),
  },
  'browser.close': {
    params: () => true,
    requires: (m) => checkBrowserCapability(m),
  },
};

export const EVENTS = /** @type {const} */ ([
  'shell.closeRequested',
  'shell.deepLink',
  'widgets.action',
  'shell.localeChanged',
  'storage.changed',
  'iac.message',
  'iac.broadcast',
  'browser.navigated',
]);

/**
 * @param {string} range
 * @param {string} version
 */
export function satisfiesEngine(range, version) {
  const r = /^\^(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (!r || !v) return false;
  const [rMajor, rMinor, vMajor, vMinor] = [r[1], r[2], v[1], v[2]].map(Number);
  if (vMajor !== rMajor) return false;
  return rMajor === 0 ? vMinor === rMinor : vMinor >= rMinor;
}

/**
 * @param {Manifest} manifest
 * @param {string} url
 */
export function networkAllowed(manifest, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'app:') return u.host === manifest.id;
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
  return (manifest.capabilities?.network ?? []).some((h) => h === u.host || h === u.hostname);
}
