// The platform contract in code. docs/contracts.md describes it; keep the two in step.
import { readFileSync } from 'node:fs';
import AjvModule from 'ajv';

// ajv ships CommonJS; under NodeNext its default import is the module object.
const Ajv = AjvModule.default;

const load = (/** @type {string} */ name) =>
  JSON.parse(readFileSync(new URL(`./schemas/${name}.schema.json`, import.meta.url), 'utf8'));

const ajv = new Ajv({ allErrors: true, useDefaults: true, allowUnionTypes: true });
const validators = {
  manifest: ajv.compile(load('manifest')),
  product: ajv.compile(load('product')),
  widget: ajv.compile(load('widget')),
};

/**
 * @param {'manifest' | 'product' | 'widget'} kind
 * @param {unknown} value
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validate(kind, value) {
  const check = validators[kind];
  if (check(value)) return { ok: true };
  return { ok: false, errors: (check.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
}

/** Shell protocol version spoken by this host. */
export const SHELL_PROTOCOL = 1;

/** How long an app has to answer shell.closeRequested before the host closes it. */
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
 *   capabilities?: { network?: string[], notifications?: boolean, secrets?: string[] }
 * }} Manifest
 */

const str = (/** @type {unknown} */ v, max = 1000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const key = (/** @type {unknown} */ v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v);

/**
 * Bridge methods an app may call. `params` checks shape; `requires` returns the
 * missing capability, or null when the manifest allows the call.
 * @type {Record<string, { params: (p: any) => boolean, requires: (m: Manifest, p: any) => string | null }>}
 */
export const METHODS = {
  'shell.hello': { params: () => true, requires: () => null },
  'shell.setTitle': { params: (p) => str(p?.title, 60), requires: () => null },
  'shell.closeResponse': { params: (p) => str(p?.nonce, 64) && typeof p?.allow === 'boolean', requires: () => null },
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
};

/** Events the host sends to an app. */
export const EVENTS = /** @type {const} */ (['shell.closeRequested', 'shell.deepLink', 'widgets.action']);

/**
 * True when `version` satisfies a caret range of the form `^MAJOR.MINOR`.
 * For 0.x, the minor version must match; otherwise the major must match and minor be at least the range's.
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
 * Whether a request URL is allowed for an app: its own origin always, declared hosts otherwise.
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
