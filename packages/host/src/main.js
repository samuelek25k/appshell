import { app, dialog, ipcMain, nativeTheme, net, protocol, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_VETO_TIMEOUT_MS, limitsFor } from '@appshell/contracts';
import { loadProduct, loadApps, ENGINE_VERSION } from './registry.js';
import { createManager } from './manager.js';
import { userInfo } from 'node:os';
import { createAccounts } from './accounts.js';
import { createEndpoints, forgetApp } from './endpoints.js';
import { createDisabledApps, forgetDisabled } from './disabled.js';
import { createLauncherPreferences, homeLauncher } from './launcher.js';
import { createIdentity } from './identity.js';
import { createServices, appendWithRotation } from './services.js';
import { createBackend } from './backend.js';
import { createBridge } from './bridge.js';
import { createAppView } from './views.js';
import { createFlag } from './flags.js';
import { loadBranding } from './branding.js';
import { createSettings } from './settings.js';
import { isHome, isOpenable, kindOf } from './kinds.js';
import { createIac } from './iac.js';
import { createLinks } from './links.js';
import { createHostWindow } from './window.js';

if (app.isPackaged && app.commandLine.hasSwitch('no-sandbox')) {
  console.error('Running with --no-sandbox is refused in packaged builds');
  app.exit(1);
}
app.enableSandbox();

const CHROME_HEIGHT = 48;
const KIOSK_BAR_HEIGHT = 28;
const HOST_UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const HOST_PRELOAD = fileURLToPath(new URL('../preload/host.cjs', import.meta.url));

const flag = createFlag(app);

const productFile = resolve(flag('--product') ?? join(process.resourcesPath, 'product', 'product.json'));
const product = loadProduct(productFile);
const productDir = dirname(productFile);
const appsRoot = resolve(flag('--apps') ?? join(productDir, 'apps'));

const branding = loadBranding(productDir);

app.setName(product.name);
app.setPath('userData', resolve(flag('--user-data') ?? join(app.getPath('appData'), product.dataDirectory)));
const dataRoot = app.getPath('userData');
const accounts = createAccounts(dataRoot, userInfo().username);
let unlocked = !accounts.activeView().locked;
/** @type {string | null} */
let accountError = null;
/** @type {{ id: string | null, on: boolean }} */
let kioskCache = { id: null, on: false };
const kioskOn = () => {
  const id = accounts.active().id;
  if (kioskCache.id !== id) kioskCache = { id, on: launcherPrefs.get().kiosk };
  return kioskCache.on;
};

/** @param {string} message */
const hostLog = (message) => {
  const dir = join(dataRoot, 'logs');
  mkdirSync(dir, { recursive: true });
  appendWithRotation(join(dir, 'host.log'), `${new Date().toISOString()} ${message}\n`);
};

const settings = createSettings(dataRoot, nativeTheme, hostLog);

/** @param {'system' | 'light' | 'dark'} theme */
function setTheme(theme) {
  if (settings.setTheme(theme)) publish();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) app.exit(0);

const catalogFlag = flag('--catalog');
if (catalogFlag && !product.policy.developerMode) throw new Error('--catalog needs policy.developerMode');
const manager = createManager({
  policy: product.policy,
  catalogUrl: catalogFlag ?? product.catalog,
  root: join(dataRoot, 'installed'),
  hostVersion: ENGINE_VERSION,
  fetch: /** @type {typeof globalThis.fetch} */ ((input, init) => net.fetch(/** @type {any} */ (input), init)),
});
let apps = loadApps(product, appsRoot, manager.installed(), hostLog);
const grantAudited = new Set();
/** @param {string} appId */
function limitsOf(appId) {
  const app = apps.get(appId);
  const limits = limitsFor(product.policy.grants, { id: appId, source: app?.source });
  if (limits.granted && !grantAudited.has(appId)) {
    grantAudited.add(appId);
    services.audit({ event: 'GRANT_APPLIED', actor: accounts.active().id, target: appId, details: { source: app?.source, storageBytes: limits.storageBytes, backendIdleMs: limits.backendIdleMs } });
  }
  return limits;
}
const services = createServices(() => accounts.root(accounts.active()), dataRoot, limitsOf);
const endpointStore = createEndpoints(() => accounts.root(accounts.active()));
const disabledApps = createDisabledApps(() => accounts.root(accounts.active()));
const autoApproveEndpoints = process.argv.includes('--approve-endpoints');
if (autoApproveEndpoints && !product.policy.developerMode) throw new Error('--approve-endpoints needs policy.developerMode');
/** @type {Set<string>} */
const endpointPrompts = new Set();
const approvedFor = (/** @type {string} */ appId) => () => endpointStore.list(appId);

/**
 * @param {string} appId
 * @param {string} key
 */
async function requestEndpoint(appId, key) {
  if (endpointStore.list(appId).includes(key)) return true;
  if (endpointPrompts.has(appId)) return false;
  const title = apps.get(appId)?.manifest.title ?? appId;
  endpointPrompts.add(appId);
  try {
    let allow = autoApproveEndpoints;
    if (!allow && win) {
      const answer = await dialog.showMessageBox(win, {
        type: 'question', buttons: ['Allow', 'Deny'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Network access', message: `Allow ${title} to connect to ${key}?`,
        detail: 'The app can then send and receive data from this address while you use this account. You can remove it later in Settings.',
      });
      allow = answer.response === 0;
    }
    if (allow) endpointStore.add(appId, key);
    services.audit({ event: allow ? 'ENDPOINT_APPROVED' : 'ENDPOINT_DENIED', actor: accounts.active().id, target: appId, details: { address: key } });
    publish();
    return allow;
  } finally {
    endpointPrompts.delete(appId);
  }
}

const launcherPrefs = createLauncherPreferences(() => accounts.root(accounts.active()));
/** @type {Set<string>} */
const failedLaunchers = new Set();
let overlay = false;
let homeSuspended = false;
let launcherSignature = '';
/** @type {string | null} */
let managerError = null;
/** @type {string | null} */
let pendingInstall = null;
/** @type {{ id: string, added: string[] } | null} */
let pendingUpdate = null;

/** @typedef {{ view: Electron.WebContentsView, title: string }} Running */
/** @type {Map<string, Running>} */
const running = new Map();
/** @type {Map<string, ReturnType<typeof createBackend>>} */
const backends = new Map();
/** @type {Map<string, Record<string, object>>} */
const widgets = new Map();
/** @type {Map<string, (allow: boolean) => void>} */
const closeWaiters = new Map();
/** @type {string | null} */
let active = null;
/** @type {Electron.BrowserWindow | null} */
let win = null;

/** @param {string} appId */
const appLog = (appId) => (/** @type {string} */ level, /** @type {string} */ message) => services.log(appId, level, message);

const identity = createIdentity(join(dataRoot, 'identity'), product.dataDirectory);

const iac = createIac({ apps: () => apps, running, open: (id) => open(id) });

let currentLocale = product.defaultLocale ?? 'en-US';

/** @param {string} loc */
function setLocale(loc) {
  currentLocale = loc;
  const isRtl = loc.startsWith('ar') || loc.startsWith('he') || loc.startsWith('fa') || loc.startsWith('ur');
  const payload = {
    locale: loc,
    languages: [loc, 'en'],
    direction: isRtl ? 'rtl' : 'ltr',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  for (const { view } of running.values()) {
    view.webContents.send('appshell:event', 'shell.localeChanged', payload);
  }
  publish();
}

const bridge = createBridge({
  policy: product.policy,
  services,
  identity,
  account: () => accounts.claims(),
  hostLog,
  locale: () => currentLocale,
  getTheme: () => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }),
  endpoints: { request: requestEndpoint, list: (appId) => endpointStore.list(appId) },
  launcher: {
    apps: () => [...apps.values()]
      .filter(({ manifest }) => isOpenable(manifest) && !product.policy.blockedApps?.includes(manifest.id) && !disabledApps.has(manifest.id))
      .map(({ manifest }) => ({ id: manifest.id, title: manifest.title, publisher: manifest.publisher, running: running.has(manifest.id) })),
    widgets: () => widgetList(),
    open: (id) => {
      const installed = apps.get(id);
      return (!installed || isOpenable(installed.manifest)) && !disabledApps.has(id) && open(id);
    },
    setTheme({ source, colors }) {
      if (colors) launcherPrefs.setColors(colors);
      if (source) setTheme(source); else publish();
    },
  },
  getVersions: (appId) => {
    const prov = manager.provenance(appId);
    const app = apps.get(appId);
    return {
      current: prov?.current.version ?? app?.manifest.version ?? '0.0.0',
      previous: prov?.previous?.version ?? null,
      installedAt: prov?.current.installedAt ?? new Date().toISOString(),
    };
  },
  onStorageChanged(appId, key, value) {
    running.get(appId)?.view.webContents.send('appshell:event', 'storage.changed', { key, value });
  },
  backendFor(appId) {
    let backend = backends.get(appId);
    if (!backend) {
      backend = createBackend(/** @type {import('./registry.js').InstalledApp} */ (apps.get(appId)), appLog(appId), limitsOf(appId).backendIdleMs);
      backends.set(appId, backend);
    }
    return backend;
  },
  onTitle(appId, title) {
    const entry = running.get(appId);
    if (entry) entry.title = title;
    publish();
  },
  onWidget(appId, widgetId, descriptor) {
    widgets.set(appId, { ...widgets.get(appId), [widgetId]: descriptor });
    publish();
  },
  onCloseResponse(appId, nonce, allow) {
    const key = `${appId}:${nonce}`;
    closeWaiters.get(key)?.(allow);
    closeWaiters.delete(key);
  },
  canReceiveIac: (targetId, fromId) => iac.canReceive(targetId, fromId),
  onIacSend: (fromId, toId, action, payload, launchIfNeeded) => iac.send(fromId, toId, action, payload, launchIfNeeded),
  onIacPublish: (fromId, channel, data) => iac.publish(fromId, channel, data),
  onIacSubscribe: (appId, channel) => iac.subscribe(appId, channel),
  onIacUnsubscribe: (appId, channel) => iac.unsubscribe(appId, channel),
});

function widgetList() {
  return [...apps.values()].filter(({ manifest }) => !disabledApps.has(manifest.id)).flatMap(({ manifest }) =>
    (manifest.widgets ?? []).flatMap((w) => {
      const descriptor = widgets.get(manifest.id)?.[w.id];
      return descriptor ? [{ appId: manifest.id, widgetId: w.id, title: w.title, descriptor }] : [];
    }));
}

function homeId() {
  const id = homeLauncher(apps, launcherPrefs.get().launcher, product.policy.blockedApps);
  return id && !failedLaunchers.has(id) ? id : null;
}

function notifyLauncher() {
  const id = homeId();
  const entry = id ? running.get(id) : undefined;
  if (!entry) return;
  const signature = JSON.stringify([[...apps.keys()], [...running.keys()], widgetList()]);
  if (signature === launcherSignature) return;
  launcherSignature = signature;
  entry.view.webContents.send('appshell:event', 'launcher.changed', null);
}

function publish() {
  if (!win) return;
  notifyLauncher();
  win.webContents.send('host:state', {
    product: product.name,
    brand: { logo: branding.logo, colors: { ...branding.colors, ...launcherPrefs.get().colors } },
    locale: currentLocale,
    kiosk: kioskOn(),
    active,
    title: active ? running.get(active)?.title : product.name,
    theme: { source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors },
    apps: [...apps.values()].map(({ manifest, protected: isProtected }) => ({
      id: manifest.id,
      title: manifest.title,
      publisher: manifest.publisher,
      protected: isProtected,
      running: running.has(manifest.id),
      disabled: disabledApps.has(manifest.id),
      capabilities: manifest.capabilities ?? {},
      kind: kindOf(manifest),
      categories: (/** @type {any} */ (manifest)).categories ?? [],
    })),
    widgets: widgetList(),
    endpoints: Object.entries(endpointStore.all()).flatMap(([appId, list]) => (apps.has(appId) ? list.map((address) => ({ appId, title: apps.get(appId)?.manifest.title ?? appId, address })) : [])),
    launcher: {
      active: homeId(),
      options: [...apps.values()].filter(({ manifest }) => isHome(manifest)).map(({ manifest }) => ({ id: manifest.id, title: manifest.title })),
    },
    manager: { ...manager.rows(), actionError: managerError, pendingInstall, pendingUpdate },
    accounts: { list: accounts.list(), activeId: accounts.activeView().id, locked: !unlocked, error: accountError, allowGuest: product.policy.allowGuest !== false },
  });
}

/**
 * @param {string} appId
 * @param {() => unknown} action
 * @param {string} [eventType]
 */
async function manage(appId, action, eventType = 'APP_MANAGED') {
  if (accounts.active().type === 'guest') { managerError = 'Guests cannot install or remove apps'; publish(); return; }
  if (apps.get(appId)?.protected) { managerError = `${appId} is a core app`; publish(); return; }
  if (product.policy.blockedApps?.includes(appId) && eventType === 'APP_INSTALLED') {
    services.audit({ event: 'APP_INSTALL_BLOCKED', actor: accounts.active().id, target: appId, details: { reason: 'policy.blockedApps' } });
    managerError = `${appId} is blocked by administrative policy`;
    publish();
    return;
  }
  homeSuspended = true;
  stop(appId);
  try {
    await action();
    if (eventType === 'APP_INSTALLED' || eventType === 'APP_ROLLEDBACK') {
      for (const name of accounts.partitions(appId)) {
        try { await session.fromPartition(name).clearCache(); } catch {}
      }
    }
    services.audit({ event: eventType, actor: accounts.active().id, target: appId });
    managerError = null;
  } catch (error) {
    const code = /** @type {any} */ (error)?.code;
    if (code === 'CAPABILITIES_ADDED') {
      pendingUpdate = { id: appId, added: /** @type {any} */ (error).added };
      managerError = null;
    } else {
      managerError = `${appId}: ${error instanceof Error ? error.message : String(error)}`;
      hostLog(`manage ${managerError}`);
    }
  }
  apps = loadApps(product, appsRoot, manager.installed(), hostLog);
  homeSuspended = false;
  failedLaunchers.delete(appId);
  layout();
  publish();
}

function layout() {
  if (!win) return;
  if (active === null) ensureHome();
  const { width, height } = win.getContentBounds();
  const top = kioskOn() ? KIOSK_BAR_HEIGHT : CHROME_HEIGHT;
  for (const [id, { view }] of running) {
    view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    view.setVisible(!overlay && id === (active ?? homeId()));
  }
}

function ensureHome() {
  const id = homeId();
  if (!id || !unlocked || homeSuspended || !win || running.has(id)) return;
  const installed = /** @type {import('./registry.js').InstalledApp} */ (apps.get(id));
  const view = createAppView(installed, appLog(id), accounts.partition(id), approvedFor(id));
  const fail = (/** @type {string} */ reason) => {
    hostLog(`launcher ${id} failed: ${reason}`);
    failedLaunchers.add(id);
    stop(id);
  };
  view.webContents.on('render-process-gone', (_event, details) => fail(details.reason));
  view.webContents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => { if (isMainFrame) fail(description); });
  running.set(id, { view, title: installed.manifest.title });
  win.contentView.addChildView(view);
}

/** @param {string} appId */
function open(appId) {
  if (!unlocked) return false;
  if (product.policy.blockedApps?.includes(appId)) {
    services.audit({ event: 'APP_LAUNCH_BLOCKED', actor: accounts.active().id, target: appId, details: { reason: 'policy.blockedApps' } });
    managerError = `${appId} is blocked by administrative policy`;
    publish();
    return false;
  }
  const installed = apps.get(appId);
  if (installed && !isOpenable(installed.manifest)) return false;
  if (disabledApps.has(appId)) return false;
  if (!installed) {
    hostLog(`cannot open ${appId}: not in apps (${[...apps.keys()].join(', ')})`);
    return false;
  }
  if (!win) {
    hostLog(`cannot open ${appId}: win is null`);
    return false;
  }
  if (!running.has(appId)) {
    const view = createAppView(installed, appLog(appId), accounts.partition(appId), approvedFor(appId));
    running.set(appId, { view, title: installed.manifest.title });
    win.contentView.addChildView(view);
  }
  active = appId;
  layout();
  running.get(appId)?.view.webContents.focus();
  publish();
  return true;
}

/** @param {string} appId */
function stop(appId) {
  const entry = running.get(appId);
  if (!entry) return;
  win?.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  running.delete(appId);
  widgets.delete(appId);
  backends.get(appId)?.stop();
  backends.delete(appId);
  iac.forget(appId);
  if (active === appId) active = null;
  layout();
  publish();
}

/** @param {string} appId */
async function requestClose(appId) {
  const entry = running.get(appId);
  if (!entry) return;
  const nonce = randomUUID();
  const allow = await new Promise((done) => {
    const key = `${appId}:${nonce}`;
    closeWaiters.set(key, done);
    setTimeout(() => { closeWaiters.delete(key); done(true); }, CLOSE_VETO_TIMEOUT_MS);
    entry.view.webContents.send('appshell:event', 'shell.closeRequested', { nonce });
  });
  if (allow) stop(appId);
}

/**
 * @param {string} appId
 */
async function requestInstall(appId) {
  if (kioskOn()) return;
  if (accounts.active().type === 'guest') { managerError = 'Guests cannot install or remove apps'; publish(); return; }
  if (apps.has(appId)) {
    pendingInstall = null;
    open(appId);
    return;
  }
  const row = manager.rows().rows.find((r) => r.id === appId);
  pendingInstall = row?.latest ? appId : null;
  managerError = row?.latest ? null : `${appId}: not in this product's catalog`;
  active = null;
  layout();
  if (win?.isMinimized()) win.restore();
  win?.focus();
  publish();
}

const links = createLinks({ protocol: product.protocol, open: (id) => open(id), requestInstall: (id) => requestInstall(id), running });

/** @param {Electron.IpcMainInvokeEvent} event */
const fromHost = (event) => event.sender === win?.webContents;

/** @param {Electron.IpcMainInvokeEvent} event */
const fromHostUnlocked = (event) => fromHost(event) && !kioskOn();

ipcMain.handle('appshell:call', (event, method, params) => {
  for (const [id, { view }] of running) {
    if (view.webContents === event.sender) return bridge(/** @type {import('./registry.js').InstalledApp} */ (apps.get(id)), method, params);
  }
  return { ok: false, error: { code: 'UNKNOWN_CALLER', message: 'caller is not a running app' } };
});
ipcMain.handle('host:ready', (event) => { if (fromHost(event)) publish(); });
ipcMain.handle('host:refreshCatalog', async (event) => { if (fromHostUnlocked(event)) { await manager.refresh(); publish(); } });
ipcMain.handle('host:install', (event, id, approveAdded) => {
  if (!fromHostUnlocked(event)) return;
  if (pendingInstall === id) pendingInstall = null;
  pendingUpdate = null;
  return manage(id, () => manager.install(id, approveAdded === true), 'APP_INSTALLED');
});
ipcMain.handle('host:dismissInstall', (event) => { if (fromHost(event)) { pendingInstall = null; pendingUpdate = null; publish(); } });
ipcMain.handle('host:rollback', (event, id) => fromHostUnlocked(event) && manage(id, () => manager.rollback(id), 'APP_ROLLEDBACK'));
ipcMain.handle('host:uninstall', (event, id) => fromHostUnlocked(event) && manage(id, async () => {
  manager.uninstall(id);
  services.removeAppData(id, accounts.roots());
  services.removeAppLogs(id, accounts.roots());
  forgetApp(accounts.roots(), id);
  forgetDisabled(accounts.roots(), id);
  for (const name of accounts.partitions(id)) await session.fromPartition(name).clearStorageData();
}, 'APP_UNINSTALLED'));
ipcMain.handle('host:setDisabled', (event, id, disabled) => {
  if (!fromHostUnlocked(event) || typeof id !== 'string' || typeof disabled !== 'boolean') return;
  const installed = apps.get(id);
  if (!installed || installed.protected || !isOpenable(installed.manifest)) return;
  disabledApps.set(id, disabled);
  services.audit({ event: disabled ? 'APP_DISABLED' : 'APP_ENABLED', actor: accounts.active().id, target: id });
  if (disabled) stop(id);
  publish();
});
ipcMain.handle('host:open', (event, id) => fromHost(event) && open(id));
ipcMain.handle('host:home', (event) => {
  if (!fromHost(event)) return;
  active = null;
  layout();
  publish();
});
ipcMain.handle('host:back', (event) => {
  if (!fromHost(event) || !active) return;
  const history = running.get(active)?.view.webContents.navigationHistory;
  if (history?.canGoBack()) history.goBack();
  else { active = null; layout(); publish(); }
});
ipcMain.handle('host:close', (event, id) => {
  if (!fromHost(event)) return;
  const target = typeof id === 'string' ? id : active;
  return target && requestClose(target);
});
function stopAll() {
  homeSuspended = true;
  for (const id of [...running.keys()]) stop(id);
}

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {Electron.IpcMainInvokeEvent} event
 * @param {() => void} change
 */
function accountChange(event, change) {
  if (!fromHost(event)) return;
  try {
    change();
    accountError = null;
  } catch (error) {
    accountError = messageOf(error);
  }
  homeSuspended = false;
  failedLaunchers.clear();
  active = null;
  layout();
  publish();
}

ipcMain.handle('host:accounts:switch', (event, id, pin) => accountChange(event, () => {
  const target = String(id);
  const secret = pin === undefined ? undefined : String(pin);
  if (kioskOn() && (unlocked || target !== accounts.active().id)) throw new Error('Exit kiosk mode first');
  accounts.verify(target, secret);
  if (target !== accounts.active().id) {
    stopAll();
    accounts.switchTo(target, secret);
  }
  unlocked = true;
}));
ipcMain.handle('host:accounts:guest', (event) => accountChange(event, () => {
  if (kioskOn()) throw new Error('Exit kiosk mode first');
  if (product.policy.allowGuest === false) throw new Error('Guest accounts are disabled');
  stopAll();
  accounts.startGuest();
  unlocked = true;
}));
ipcMain.handle('host:accounts:add', (event, name, pin) => accountChange(event, () => {
  if (kioskOn()) throw new Error('Exit kiosk mode first');
  accounts.createLocal(String(name), pin === undefined ? undefined : String(pin));
}));
ipcMain.handle('host:accounts:remove', async (event, id, pin) => {
  if (!fromHostUnlocked(event)) return;
  const target = String(id);
  const names = [...apps.keys()].map((appId) => accounts.partition(appId, target));
  accountChange(event, () => {
    if (target === accounts.active().id) throw new Error('Switch to another account before removing this one');
    accounts.remove(target, pin === undefined ? undefined : String(pin));
  });
  if (!accountError) for (const name of names) await session.fromPartition(name).clearStorageData();
});
ipcMain.handle('host:endpoints:remove', (event, appId, address) => {
  if (!fromHostUnlocked(event)) return;
  endpointStore.remove(String(appId), String(address));
  services.audit({ event: 'ENDPOINT_REMOVED', actor: accounts.active().id, target: String(appId), details: { address: String(address) } });
  publish();
});
ipcMain.handle('host:kiosk', (event, on, pin) => {
  if (!fromHost(event)) return;
  const account = accounts.active();
  try {
    if (on === true) {
      if (account.type !== 'local' || !accounts.activeView().locked) throw new Error('Set a PIN on this account before starting kiosk mode');
      if (kioskOn()) return;
    } else {
      accounts.verify(account.id, pin === undefined ? undefined : String(pin));
    }
    launcherPrefs.setKiosk(on === true);
    kioskCache = { id: account.id, on: on === true };
    services.audit({ event: on === true ? 'KIOSK_STARTED' : 'KIOSK_ENDED', actor: account.id });
    accountError = null;
  } catch (error) {
    accountError = messageOf(error);
  }
  pendingInstall = null;
  active = null;
  layout();
  publish();
});
ipcMain.handle('host:overlay', (event, open) => {
  if (!fromHost(event)) return;
  overlay = open === true;
  layout();
});
ipcMain.handle('host:launcher:set', (event, id) => {
  if (!fromHostUnlocked(event)) return;
  const next = id === null ? null : String(id);
  if (next !== null && !homeLauncher(apps, next, product.policy.blockedApps)) return;
  const previous = homeId();
  launcherPrefs.setLauncher(next);
  launcherPrefs.resetColors();
  failedLaunchers.clear();
  if (previous && previous !== next) stop(previous);
  active = null;
  layout();
  publish();
});
ipcMain.handle('host:setTheme', (event, theme) => {
  if (fromHost(event) && ['system', 'light', 'dark'].includes(theme)) {
    setTheme(/** @type {'system' | 'light' | 'dark'} */ (theme));
  }
});
ipcMain.handle('host:setLocale', (event, loc) => {
  if (fromHost(event) && typeof loc === 'string') {
    setLocale(loc);
  }
});
ipcMain.handle('host:widgetAction', (event, appId, widgetId, actionId) => {
  if (!fromHost(event)) return;
  const descriptor = /** @type {any} */ (widgets.get(appId)?.[widgetId]);
  const declared = descriptor?.blocks?.some((/** @type {any} */ b) => b.type === 'actions' && b.actions.some((/** @type {any} */ a) => a.id === actionId));
  if (!declared || !open(appId)) return;
  running.get(appId)?.view.webContents.send('appshell:event', 'widgets.action', { widget: widgetId, action: actionId });
});
nativeTheme.on('updated', () => {
  publish();
  const themePayload = { source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors };
  for (const { view } of running.values()) {
    view.webContents.send('appshell:event', 'shell.themeChanged', themePayload);
  }
});
app.on('second-instance', (_event, argv) => {
  links.from(argv).forEach(links.handle);
  if (win?.isMinimized()) win.restore();
  win?.focus();
});
app.on('open-url', (event, url) => { event.preventDefault(); app.whenReady().then(() => links.handle(url)); });
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(async () => {
  if (app.isPackaged) app.setAsDefaultProtocolClient(product.protocol);
  win = createHostWindow({ title: product.name, icon: branding.icon, preload: HOST_PRELOAD, layout, log: hostLog, onClosed: () => { win = null; } });
  await win.loadFile(HOST_UI);
  hostLog(`started ${product.name} with ${apps.size} app(s)`);
  manager.refresh().then(publish);
  links.from(process.argv).forEach(links.handle);

  setInterval(() => manager.refresh().then(publish), 60 * 60 * 1000).unref();
});
