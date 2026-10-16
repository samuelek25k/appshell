import { METHODS, ERRORS, SHELL_PROTOCOL, validate } from '@appshell/contracts';
import { fail } from './services.js';

/**
 * @typedef {{
 *   policy: { capabilities?: 'warn' | 'enforce', developerMode?: boolean, blockedApps?: string[], requireReview?: boolean },
 *   services: ReturnType<typeof import('./services.js').createServices>,
 *   backendFor: (appId: string) => ReturnType<typeof import('./backend.js').createBackend>,
 *   identity: ReturnType<typeof import('./identity.js').createIdentity>,
 *   onTitle: (appId: string, title: string) => void,
 *   onWidget: (appId: string, widgetId: string, descriptor: object) => void,
 *   onCloseResponse: (appId: string, nonce: string, allow: boolean) => void,
 *   hostLog: (message: string) => void,
 *   locale?: string,
 *   onStorageChanged?: (appId: string, key: string, value: unknown) => void,
 *   onIacSend?: (fromId: string, toId: string, action: string, payload: unknown, launchIfNeeded?: boolean) => Promise<{ delivered: boolean, targetRunning: boolean }>,
 *   onIacPublish?: (fromId: string, channel: string, data: unknown) => { subscribersCount: number },
 *   onIacSubscribe?: (appId: string, channel: string) => boolean,
 *   onIacUnsubscribe?: (appId: string, channel: string) => boolean,
 *   canReceiveIac?: (targetId: string, fromId: string) => boolean,
 *   getTheme?: () => { source: 'system' | 'light' | 'dark', dark: boolean },
 *   getVersions?: (appId: string) => { current: string, previous: string | null, installedAt: string },
 *   browser?: ReturnType<typeof import('./browser.js').createBrowserManager>,
 * }} BridgeDeps
 */

/**
 * @param {BridgeDeps} deps
 * @returns {(app: import('./registry.js').InstalledApp, method: string, params: any) => Promise<{ ok: true, result: unknown } | { ok: false, error: { code: string, message: string } }>}
 */
export function createBridge(deps) {
  const { services, policy } = deps;

  /** @type {Record<string, (id: string, p: any, app: import('./registry.js').InstalledApp) => unknown>} */
  const handlers = {
    'shell.hello': (id) => ({ protocol: SHELL_PROTOCOL, appId: id }),
    'shell.setTitle': (id, p) => deps.onTitle(id, p.title),
    'shell.closeResponse': (id, p) => deps.onCloseResponse(id, p.nonce, p.allow),
    'shell.getLocale': () => {
      const loc = deps.locale ?? (typeof Intl === 'object' ? Intl.DateTimeFormat().resolvedOptions().locale : 'en-US');
      const isRtl = loc.startsWith('ar') || loc.startsWith('he') || loc.startsWith('fa') || loc.startsWith('ur');
      return {
        locale: loc,
        languages: typeof navigator === 'object' && navigator.languages ? [...navigator.languages] : [loc, 'en'],
        direction: isRtl ? 'rtl' : 'ltr',
        timeZone: typeof Intl === 'object' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
      };
    },
    'shell.getTheme': () => {
      if (deps.getTheme) return deps.getTheme();
      return { source: 'system', dark: false };
    },
    'shell.getVersions': (id, _p, app) => {
      if (deps.getVersions) return deps.getVersions(id);
      return { current: app.manifest.version, previous: null, installedAt: new Date().toISOString() };
    },
    'widgets.update': (id, p) => {
      const result = validate('widget', p.descriptor);
      if (!result.ok) throw fail(ERRORS.INVALID_PARAMS, result.errors.join('; '));
      deps.onWidget(id, p.id, p.descriptor);
      return null;
    },
    'storage.get': (id, p) => services.storage.get(id, p.key),
    'storage.set': (id, p) => {
      const res = services.storage.set(id, p.key, p.value);
      deps.onStorageChanged?.(id, p.key, p.value);
      return res;
    },
    'storage.remove': (id, p) => {
      const res = services.storage.remove(id, p.key);
      deps.onStorageChanged?.(id, p.key, undefined);
      return res;
    },
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
    'identity.token': (id) => {
      services.audit({ event: 'TOKEN_ISSUED', target: id });
      return deps.identity.mint(id);
    },
    'identity.publicKey': () => deps.identity.publicJwk(),
    'iac.send': async (id, p) => {
      if (policy.blockedApps?.includes(p.to)) {
        services.audit({ event: 'IAC_DENIED', target: id, details: { to: p.to, action: p.action, reason: 'target blocked by policy' } });
        throw fail(ERRORS.CAPABILITY_DENIED, `target app ${p.to} is blocked by administrative policy`);
      }
      if (deps.canReceiveIac && !deps.canReceiveIac(p.to, id)) {
        services.audit({ event: 'IAC_DENIED', target: id, details: { to: p.to, action: p.action, reason: 'target does not allow receiving from sender' } });
        throw fail(ERRORS.CAPABILITY_DENIED, `target app ${p.to} does not accept inter-app messages from ${id}`);
      }
      const res = await (deps.onIacSend?.(id, p.to, p.action, p.payload, p.launchIfNeeded) ?? Promise.resolve({ delivered: false, targetRunning: false }));
      services.audit({ event: 'IAC_MESSAGE_SENT', target: id, details: { to: p.to, action: p.action, delivered: res.delivered } });
      return res;
    },
    'iac.publish': (id, p) => {
      const res = deps.onIacPublish?.(id, p.channel, p.data) ?? { subscribersCount: 0 };
      services.audit({ event: 'IAC_PUBLISHED', target: id, details: { channel: p.channel, subscribersCount: res.subscribersCount } });
      return res;
    },
    'iac.subscribe': (id, p) => {
      const ok = deps.onIacSubscribe?.(id, p.channel) ?? true;
      return { channel: p.channel, subscribed: ok };
    },
    'iac.unsubscribe': (id, p) => {
      const ok = deps.onIacUnsubscribe?.(id, p.channel) ?? true;
      return { channel: p.channel, unsubscribed: ok };
    },
    'browser.navigate': (id, p, app) => deps.browser ? deps.browser.navigate(id, app.manifest, p.url) : Promise.reject(fail(ERRORS.CAPABILITY_DENIED, 'browser manager not available')),
    'browser.act': (id, p) => deps.browser ? deps.browser.act(id, p) : Promise.reject(fail(ERRORS.CAPABILITY_DENIED, 'browser manager not available')),
    'browser.extract': (id, p) => deps.browser ? deps.browser.extract(id, p) : Promise.reject(fail(ERRORS.CAPABILITY_DENIED, 'browser manager not available')),
    'browser.evaluate': (id, p) => deps.browser ? deps.browser.evaluate(id, p) : Promise.reject(fail(ERRORS.CAPABILITY_DENIED, 'browser manager not available')),
    'browser.screenshot': (id) => deps.browser ? deps.browser.screenshot(id) : Promise.reject(fail(ERRORS.CAPABILITY_DENIED, 'browser manager not available')),
    'browser.status': (id) => deps.browser ? deps.browser.status(id) : Promise.resolve({ active: false }),
    'browser.close': (id) => deps.browser ? deps.browser.close(id) : Promise.resolve({ closed: false }),
  };

  return async (app, method, params) => {
    const id = app.manifest.id;
    try {
      const spec = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined;
      if (!spec) throw fail(ERRORS.UNKNOWN_METHOD, `unknown method ${String(method).slice(0, 64)}`);
      if (!spec.params(params)) throw fail(ERRORS.INVALID_PARAMS, `invalid params for ${method}`);
      const missing = spec.requires(app.manifest, params);
      if (missing) {
        services.audit({ event: 'CAPABILITY_DENIED', target: id, details: { method, missing } });
        if ((policy.capabilities ?? 'enforce') === 'enforce') throw fail(ERRORS.CAPABILITY_DENIED, `${method} needs capability ${missing}`);
        deps.hostLog(`[warn] ${id} called ${method} without capability ${missing}`);
        services.log(id, 'warn', `undeclared capability ${missing} used by ${method}`);
      }
      return { ok: true, result: await handlers[method](id, params, app) };
    } catch (error) {
      const e = /** @type {Error & { code?: string }} */ (error);
      return { ok: false, error: { code: e.code ?? 'INTERNAL', message: e.code ? e.message : 'internal error' } };
    }
  };
}
