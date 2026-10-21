import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_VETO_TIMEOUT_MS, allowsIacReceive } from '@appshell/contracts';
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

if (app.isPackaged && app.commandLine.hasSwitch('no-sandbox')) {
  console.error('Running with --no-sandbox is refused in packaged builds');
  app.exit(1);
}
app.enableSandbox();

const CHROME_HEIGHT = 48;
const HOST_UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const HOST_PRELOAD = fileURLToPath(new URL('../preload/host.cjs', import.meta.url));

/** @param {string} name */
const flag = (name) => {
  if (app.isPackaged) return undefined;
  const joined = process.argv.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const productFile = resolve(flag('--product') ?? join(process.resourcesPath, 'product', 'product.json'));
const product = loadProduct(productFile);
const productDir = dirname(productFile);
const assetsDir = join(productDir, 'assets');
const appsRoot = resolve(flag('--apps') ?? join(productDir, 'apps'));

/** @type {string | null} */
let brandLogo = null;
const markCandidate = [
  join(assetsDir, 'mark.svg'),
  join(productDir, 'mark.svg'),
  join(process.resourcesPath, 'product', 'assets', 'mark.svg'),
  join(process.resourcesPath, 'product', 'mark.svg'),
].find((p) => existsSync(p));
if (markCandidate) {
  try {
    const svgText = readFileSync(markCandidate, 'utf8');
    brandLogo = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
  } catch {}
}

/** @type {Record<string, string>} */
let brandColors = {};
const brandFile = [
  join(assetsDir, 'brand.json'),
  join(productDir, 'brand.json'),
  join(process.resourcesPath, 'product', 'assets', 'brand.json'),
  join(process.resourcesPath, 'product', 'brand.json'),
].find((p) => existsSync(p));
if (brandFile) {
  try {
    brandColors = JSON.parse(readFileSync(brandFile, 'utf8'));
  } catch {}
}

app.setName(product.name);
app.setPath('userData', resolve(flag('--user-data') ?? join(app.getPath('appData'), product.dataDirectory)));
const dataRoot = app.getPath('userData');
const accounts = createAccounts(dataRoot, userInfo().username);
let unlocked = !accounts.activeView().locked;
/** @type {string | null} */
let accountError = null;

const settingsFile = join(dataRoot, 'settings.json');
/** @type {{ theme?: 'system' | 'light' | 'dark' }} */
let settings = {};
try {
  settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
} catch {}
if (settings.theme && ['system', 'light', 'dark'].includes(settings.theme)) {
  nativeTheme.themeSource = settings.theme;
}

/** @param {'system' | 'light' | 'dark'} theme */
function setTheme(theme) {
  if (!['system', 'light', 'dark'].includes(theme)) return;
  nativeTheme.themeSource = theme;
  settings.theme = theme;
  try {
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    hostLog(`failed to save settings: ${error instanceof Error ? error.message : String(error)}`);
  }
  publish();
}

/** @param {string} message */
const hostLog = (message) => {
  const dir = join(dataRoot, 'logs');
  mkdirSync(dir, { recursive: true });
  appendWithRotation(join(dir, 'host.log'), `${new Date().toISOString()} ${message}\n`);
};

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
const services = createServices(() => accounts.root(accounts.active()), dataRoot);
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
/** @type {BrowserWindow | null} */
let win = null;

/** @param {string} appId */
const appLog = (appId) => (/** @type {string} */ level, /** @type {string} */ message) => services.log(appId, level, message);

const identity = createIdentity(join(dataRoot, 'identity'), product.dataDirectory);

/** @type {Map<string, Set<string>>} */
const channelSubscriptions = new Map();

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
      .filter(({ manifest }) => manifest.kind !== 'launcher' && !product.policy.blockedApps?.includes(manifest.id) && !disabledApps.has(manifest.id))
      .map(({ manifest }) => ({ id: manifest.id, title: manifest.title, publisher: manifest.publisher, running: running.has(manifest.id) })),
    widgets: () => widgetList(),
    open: (id) => apps.get(id)?.manifest.kind !== 'launcher' && !disabledApps.has(id) && open(id),
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
      backend = createBackend(/** @type {import('./registry.js').InstalledApp} */ (apps.get(appId)), appLog(appId));
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
  canReceiveIac(targetId, fromId) {
    const target = apps.get(targetId);
    if (!target) return false;
    return allowsIacReceive(target.manifest, fromId);
  },
  async onIacSend(fromId, toId, action, payload, launchIfNeeded) {
    let entry = running.get(toId);
    if (!entry && launchIfNeeded) {
      if (open(toId)) {
        entry = running.get(toId);
      }
    }
    if (!entry) {
      return { delivered: false, targetRunning: false };
    }
    const timestamp = Date.now();
    entry.view.webContents.send('appshell:event', 'iac.message', {
      from: fromId,
      action,
      payload,
      timestamp,
    });
    return { delivered: true, targetRunning: true };
  },
  onIacPublish(fromId, channel, data) {
    const subscribers = channelSubscriptions.get(channel);
    if (!subscribers || subscribers.size === 0) return { subscribersCount: 0 };
    let count = 0;
    const timestamp = Date.now();
    for (const subId of subscribers) {
      if (subId === fromId) continue;
      const target = apps.get(subId);
      if (!target || !allowsIacReceive(target.manifest, fromId)) continue;
      const entry = running.get(subId);
      if (entry) {
        entry.view.webContents.send('appshell:event', 'iac.broadcast', {
          channel,
          from: fromId,
          data,
          timestamp,
        });
        count++;
      }
    }
    return { subscribersCount: count };
  },
  onIacSubscribe(appId, channel) {
    let set = channelSubscriptions.get(channel);
    if (!set) {
      set = new Set();
      channelSubscriptions.set(channel, set);
    }
    set.add(appId);
    return true;
  },
  onIacUnsubscribe(appId, channel) {
    const set = channelSubscriptions.get(channel);
    if (set) {
      set.delete(appId);
      if (set.size === 0) channelSubscriptions.delete(channel);
    }
    return true;
  },
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
    brand: { logo: brandLogo, colors: { ...brandColors, ...launcherPrefs.get().colors } },
    locale: currentLocale,
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
      kind: manifest.kind ?? 'app',
      categories: (/** @type {any} */ (manifest)).categories ?? [],
    })),
    widgets: widgetList(),
    endpoints: Object.entries(endpointStore.all()).flatMap(([appId, list]) => (apps.has(appId) ? list.map((address) => ({ appId, title: apps.get(appId)?.manifest.title ?? appId, address })) : [])),
    launcher: {
      active: homeId(),
      options: [...apps.values()].filter(({ manifest }) => manifest.kind === 'launcher').map(({ manifest }) => ({ id: manifest.id, title: manifest.title })),
    },
    manager: { ...manager.rows(), actionError: managerError, pendingInstall },
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
    managerError = `${appId}: ${error instanceof Error ? error.message : String(error)}`;
    hostLog(`manage ${managerError}`);
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
  for (const [id, { view }] of running) {
    view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
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
  if (installed?.manifest.kind === 'launcher') return false;
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
  for (const [ch, set] of channelSubscriptions.entries()) {
    set.delete(appId);
    if (set.size === 0) channelSubscriptions.delete(ch);
  }
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

/** @param {string} link */
function handleLink(link) {
  let url;
  try { url = new URL(link); } catch { return; }
  if (url.protocol !== `${product.protocol}:`) return;
  const install = url.host === '_' && /^\/install\/([a-z][a-z0-9.-]{0,63})$/.exec(url.pathname);
  if (install) { requestInstall(install[1]); return; }
  if (!open(url.host)) return;
  const wc = running.get(url.host)?.view.webContents;
  const send = () => wc?.send('appshell:event', 'shell.deepLink', { path: url.pathname + url.search });
  if (wc?.isLoading()) wc.once('did-finish-load', send); else send();
}

/**
 * @param {string} appId
 */
async function requestInstall(appId) {
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

const links = (/** @type {string[]} */ argv) => argv.filter((a) => a.startsWith(`${product.protocol}://`));

/** @param {Electron.IpcMainInvokeEvent} event */
const fromHost = (event) => event.sender === win?.webContents;

ipcMain.handle('appshell:call', (event, method, params) => {
  for (const [id, { view }] of running) {
    if (view.webContents === event.sender) return bridge(/** @type {import('./registry.js').InstalledApp} */ (apps.get(id)), method, params);
  }
  return { ok: false, error: { code: 'UNKNOWN_CALLER', message: 'caller is not a running app' } };
});
ipcMain.handle('host:ready', (event) => { if (fromHost(event)) publish(); });
ipcMain.handle('host:refreshCatalog', async (event) => { if (fromHost(event)) { await manager.refresh(); publish(); } });
ipcMain.handle('host:install', (event, id) => {
  if (!fromHost(event)) return;
  if (pendingInstall === id) pendingInstall = null;
  return manage(id, () => manager.install(id), 'APP_INSTALLED');
});
ipcMain.handle('host:dismissInstall', (event) => { if (fromHost(event)) { pendingInstall = null; publish(); } });
ipcMain.handle('host:rollback', (event, id) => fromHost(event) && manage(id, () => manager.rollback(id), 'APP_ROLLEDBACK'));
ipcMain.handle('host:uninstall', (event, id) => fromHost(event) && manage(id, async () => {
  manager.uninstall(id);
  services.removeAppData(id, accounts.roots());
  services.removeAppLogs(id, accounts.roots());
  forgetApp(accounts.roots(), id);
  forgetDisabled(accounts.roots(), id);
  for (const name of accounts.partitions(id)) await session.fromPartition(name).clearStorageData();
}, 'APP_UNINSTALLED'));
ipcMain.handle('host:setDisabled', (event, id, disabled) => {
  if (!fromHost(event) || typeof id !== 'string' || typeof disabled !== 'boolean') return;
  const installed = apps.get(id);
  if (!installed || installed.protected || installed.manifest.kind === 'launcher') return;
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
ipcMain.handle('host:close', (event) => fromHost(event) && active && requestClose(active));
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
  accounts.verify(target, secret);
  if (target !== accounts.active().id) {
    stopAll();
    accounts.switchTo(target, secret);
  }
  unlocked = true;
}));
ipcMain.handle('host:accounts:guest', (event) => accountChange(event, () => {
  if (product.policy.allowGuest === false) throw new Error('Guest accounts are disabled');
  stopAll();
  accounts.startGuest();
  unlocked = true;
}));
ipcMain.handle('host:accounts:add', (event, name, pin) => accountChange(event, () => {
  accounts.createLocal(String(name), pin === undefined ? undefined : String(pin));
}));
ipcMain.handle('host:accounts:remove', async (event, id, pin) => {
  if (!fromHost(event)) return;
  const target = String(id);
  const names = [...apps.keys()].map((appId) => accounts.partition(appId, target));
  accountChange(event, () => {
    if (target === accounts.active().id) throw new Error('Switch to another account before removing this one');
    accounts.remove(target, pin === undefined ? undefined : String(pin));
  });
  if (!accountError) for (const name of names) await session.fromPartition(name).clearStorageData();
});
ipcMain.handle('host:endpoints:remove', (event, appId, address) => {
  if (!fromHost(event)) return;
  endpointStore.remove(String(appId), String(address));
  services.audit({ event: 'ENDPOINT_REMOVED', actor: accounts.active().id, target: String(appId), details: { address: String(address) } });
  publish();
});
ipcMain.handle('host:overlay', (event, open) => {
  if (!fromHost(event)) return;
  overlay = open === true;
  layout();
});
ipcMain.handle('host:launcher:set', (event, id) => {
  if (!fromHost(event)) return;
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
  links(argv).forEach(handleLink);
  if (win?.isMinimized()) win.restore();
  win?.focus();
});
app.on('open-url', (event, url) => { event.preventDefault(); app.whenReady().then(() => handleLink(url)); });
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.whenReady().then(async () => {
  if (app.isPackaged) app.setAsDefaultProtocolClient(product.protocol);
  const iconFile = [
    join(assetsDir, 'icon.png'),
    join(assetsDir, 'icon.ico'),
    join(productDir, 'icon.png'),
    join(productDir, 'icon.ico'),
    join(process.resourcesPath, 'product', 'assets', 'icon.png'),
    join(process.resourcesPath, 'product', 'assets', 'icon.ico'),
    join(process.resourcesPath, 'product', 'icon.png'),
    join(process.resourcesPath, 'product', 'icon.ico'),
  ].find((p) => existsSync(p));
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: product.name,
    ...(iconFile ? { icon: iconFile } : {}),
    autoHideMenuBar: true,
    webPreferences: { preload: HOST_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('closed', () => { win = null; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => { if (e.level === 'error') hostLog(`host ui: ${e.message}`); });
  win.webContents.on('preload-error', (_e, file, error) => hostLog(`host preload ${file}: ${error.message}`));
  await win.loadFile(HOST_UI);
  hostLog(`started ${product.name} with ${apps.size} app(s)`);
  manager.refresh().then(publish);
  links(process.argv).forEach(handleLink);

  setInterval(() => manager.refresh().then(publish), 60 * 60 * 1000).unref();
});
