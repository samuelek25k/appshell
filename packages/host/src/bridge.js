// The only path from app code to platform services. The caller is identified by the
// webContents that sent the message; nothing in the message can change that.
import { METHODS, ERRORS, SHELL_PROTOCOL, validate } from '@appshell/contracts';
import { fail } from './services.js';

/**
 * @typedef {{
 *   policy: { capabilities: 'warn' | 'enforce', developerMode?: boolean },
 *   services: ReturnType<typeof import('./services.js').createServices>,
 *   backendFor: (appId: string) => ReturnType<typeof import('./backend.js').createBackend>,
 *   identity: ReturnType<typeof import('./identity.js').createIdentity>,
 *   onTitle: (appId: string, title: string) => void,
 *   onWidget: (appId: string, widgetId: string, descriptor: object) => void,
 *   onCloseResponse: (appId: string, nonce: string, allow: boolean) => void,
 *   hostLog: (message: string) => void,
 *   onListApps?: () => { id: string, title: string, publisher: string, running: boolean }[],
 *   onLaunchApp?: (appId: string) => boolean,
 *   onGetWidgets?: () => object[],
 * }} BridgeDeps
 */

/**
 * @param {BridgeDeps} deps
 * @returns {(app: import('./registry.js').InstalledApp, method: string, params: any) => Promise<{ ok: true, result: unknown } | { ok: false, error: { code: string, message: string } }>}
 */
export function createBridge(deps) {
  const { services, policy } = deps;

  /** @type {Record<string, (id: string, p: any) => unknown>} */
  const handlers = {
    'shell.hello': (id) => ({ protocol: SHELL_PROTOCOL, appId: id }),
    'shell.setTitle': (id, p) => deps.onTitle(id, p.title),
    'shell.closeResponse': (id, p) => deps.onCloseResponse(id, p.nonce, p.allow),
    'shell.listInstalledApps': () => deps.onListApps?.() ?? [],
    'shell.launchApp': (_id, p) => deps.onLaunchApp?.(p.id) ?? false,
    'shell.getWidgets': () => deps.onGetWidgets?.() ?? [],
    'shell.setPreferences': (id, p) => services.storage.set(id, '__launcher_prefs__', p.preferences),
    'shell.getPreferences': async (id) => (await services.storage.get(id, '__launcher_prefs__')) ?? {},
    'widgets.update': (id, p) => {
      const result = validate('widget', p.descriptor);
      if (!result.ok) throw fail(ERRORS.INVALID_PARAMS, result.errors.join('; '));
      deps.onWidget(id, p.id, p.descriptor);
      return null;
    },
    'storage.get': (id, p) => services.storage.get(id, p.key),
    'storage.set': (id, p) => services.storage.set(id, p.key, p.value),
    'storage.remove': (id, p) => services.storage.remove(id, p.key),
    'secrets.get': (id, p) => {
      services.secrets.assertAvailable(policy.developerMode === true);
      return services.secrets.get(id, p.name);
    },
    'secrets.set': (id, p) => {
      services.secrets.assertAvailable(policy.developerMode === true);
      return services.secrets.set(id, p.name, p.value);
    },
    'notifications.show': (_id, p) => services.notify(p.title, p.body),
    'log.write': (id, p) => services.log(id, p.level, p.message),
    'backend.call': (id, p) => deps.backendFor(id).call(p.method, p.params),
    'identity.token': (id) => deps.identity.mint(id),
    'identity.publicKey': () => deps.identity.publicJwk(),
  };

  return async (app, method, params) => {
    const id = app.manifest.id;
    try {
      const spec = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;
      if (!spec) throw fail(ERRORS.UNKNOWN_METHOD, `unknown method ${String(method).slice(0, 64)}`);
      if (!spec.params(params)) throw fail(ERRORS.INVALID_PARAMS, `invalid params for ${method}`);
      const missing = spec.requires(app.manifest, params);
      if (missing) {
        if (policy.capabilities === 'enforce') throw fail(ERRORS.CAPABILITY_DENIED, `${method} needs capability ${missing}`);
        deps.hostLog(`[warn] ${id} called ${method} without capability ${missing}`);
        services.log(id, 'warn', `undeclared capability ${missing} used by ${method}`);
      }
      return { ok: true, result: await handlers[method](id, params) };
    } catch (error) {
      const e = /** @type {Error & { code?: string }} */ (error);
      return { ok: false, error: { code: e.code ?? 'INTERNAL', message: e.code ? e.message : 'internal error' } };
    }
  };
}
