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
 *   kind?: 'app' | 'launcher',
 *   widgets?: { id: string, title: string }[],
 *   capabilities?: { network?: string[], notifications?: boolean, secrets?: string[], identity?: boolean, launcher?: boolean, userEndpoints?: boolean, iac?: boolean | { send?: string[], receive?: string[], channels?: string[] } }
 * }} Manifest
 */

const str = (/** @type {unknown} */ v, max = 1000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const key = (/** @type {unknown} */ v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v);

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

const jsonSize = (/** @type {unknown} */ v) => { try { return v === undefined ? 0 : JSON.stringify(v).length; } catch { return Infinity; } };
export const THEME_COLOR_KEYS = /** @type {const} */ (['brand', 'panel', 'ink']);
export const THEME_SOURCES = /** @type {const} */ (['system', 'light', 'dark']);

/** @param {unknown} v */
const themeParams = (v) => {
  const p = /** @type {any} */ (v);
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return false;
  if (p.source === undefined && p.colors === undefined) return false;
  if (p.source !== undefined && !THEME_SOURCES.includes(p.source)) return false;
  if (p.colors === undefined) return true;
  if (typeof p.colors !== 'object' || p.colors === null || Array.isArray(p.colors)) return false;
  return Object.entries(p.colors).every(([k, c]) => THEME_COLOR_KEYS.includes(/** @type {any} */ (k)) && typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
};

const launcherCapability = (/** @type {Manifest} */ m) => (m.capabilities?.launcher === true && m.kind === 'launcher' ? null : 'launcher');

const MAX_IAC_PAYLOAD = 64 * 1024;

/**
 * @param {Manifest} m
 * @param {string} senderId
 */
export function allowsIacReceive(m, senderId) {
  const iac = m.capabilities?.iac;
  if (!iac || typeof iac !== 'object' || !Array.isArray(iac.receive)) return false;
  return iac.receive.includes('*') || iac.receive.includes(senderId);
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
  'network.requestEndpoint': { params: (p) => str(p?.url, 300), requires: (m) => (m.capabilities?.userEndpoints ? null : 'userEndpoints') },
  'network.endpoints': { params: () => true, requires: (m) => (m.capabilities?.userEndpoints ? null : 'userEndpoints') },
  'launcher.apps': { params: () => true, requires: launcherCapability },
  'launcher.widgets': { params: () => true, requires: launcherCapability },
  'launcher.open': { params: (p) => str(p?.id, 64), requires: launcherCapability },
  'launcher.setTheme': { params: themeParams, requires: launcherCapability },
  'iac.send': {
    params: (p) => str(p?.to, 64) && str(p?.action, 64) && jsonSize(p?.payload) <= MAX_IAC_PAYLOAD && (p?.launchIfNeeded === undefined || typeof p.launchIfNeeded === 'boolean'),
    requires: (m, p) => checkIacSend(m, p.to),
  },
  'iac.publish': {
    params: (p) => key(p?.channel) && p?.data !== undefined && jsonSize(p?.data) <= MAX_IAC_PAYLOAD,
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
};

export const EVENTS = /** @type {const} */ ([
  'shell.closeRequested',
  'shell.deepLink',
  'shell.themeChanged',
  'widgets.action',
  'shell.localeChanged',
  'storage.changed',
  'launcher.changed',
  'iac.message',
  'iac.broadcast',
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

/** @param {string} host */
function isLocalHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]') return true;
  if (/^\[f[cd][0-9a-f]{2}:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/** @param {URL} u */
const endpointKeyOf = (u) => `${u.protocol === 'https:' || u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`;

/**
 * @param {string} url
 * @returns {string | null}
 */
export function parseEndpoint(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return null;
  if (u.username || u.password || !u.hostname) return null;
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  if (!secure && !isLocalHost(u.hostname)) return null;
  return endpointKeyOf(u);
}

/**
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopback(host) {
  if (!host) return false;
  const name = (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]).toLowerCase();
  return name === 'localhost' || name.startsWith('127.') || name === '::1';
}

/**
 * @param {Manifest} manifest
 * @param {string} url
 * @param {string[]} [approved]
 */
export function networkAllowed(manifest, url, approved = []) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'app:') return u.host === manifest.id;
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && approved.includes(endpointKeyOf(u))) return true;
  const loopback = isLoopback(u.hostname);
  const allowedProtocols = loopback ? ['https:', 'wss:', 'http:', 'ws:'] : ['https:', 'wss:'];
  if (!allowedProtocols.includes(u.protocol)) return false;
  return (manifest.capabilities?.network ?? []).some((h) => h === u.host || h === u.hostname);
}

