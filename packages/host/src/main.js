import { app, BrowserWindow, globalShortcut, ipcMain, net, protocol, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_VETO_TIMEOUT_MS } from '@appshell/contracts';
import { loadProduct, loadApps, HOST_VERSION } from './registry.js';
import { createManager } from './manager.js';
import { createIdentity } from './identity.js';
import { createServices } from './services.js';
import { createBackend } from './backend.js';
import { createBridge } from './bridge.js';
import { createAppView } from './views.js';

const CHROME_HEIGHT = 48;
const HOST_UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const HOST_PRELOAD = fileURLToPath(new URL('../preload/host.cjs', import.meta.url));

/** Reads `--name value` or `--name=value`. @param {string} name */
const flag = (name) => {
  const joined = process.argv.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const productFile = resolve(flag('--product') ?? join(process.resourcesPath, 'product', 'product.json'));
const product = loadProduct(productFile);
const appsRoot = resolve(flag('--apps') ?? join(dirname(productFile), 'apps'));

app.setName(product.name);
app.setPath('userData', resolve(flag('--user-data') ?? join(app.getPath('appData'), product.dataDirectory)));
const dataRoot = app.getPath('userData');

/** @param {string} message */
const hostLog = (message) => {
  mkdirSync(join(dataRoot, 'logs'), { recursive: true });
  appendFileSync(join(dataRoot, 'logs', 'host.log'), `${new Date().toISOString()} ${message}\n`);
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

if (!app.requestSingleInstanceLock()) app.exit(0);

// A --catalog override is for app authors only.
const catalogFlag = flag('--catalog');
if (catalogFlag && !product.policy.developerMode) throw new Error('--catalog needs policy.developerMode');
const manager = createManager({
  policy: product.policy,
  catalogUrl: catalogFlag ?? product.catalog,
  root: join(dataRoot, 'installed'),
  hostVersion: HOST_VERSION,
  fetch: /** @type {typeof globalThis.fetch} */ ((input, init) => net.fetch(/** @type {any} */ (input), init)),
});
let apps = loadApps(product, appsRoot, manager.installed(), hostLog);
const services = createServices(dataRoot);
/** @type {string | null} */
let managerError = null;
/** App id awaiting the user's confirmation after an install link. @type {string | null} */
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

const bridge = createBridge({
  policy: product.policy,
  services,
  identity,
  hostLog,
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
  onListApps() {
    return [...apps.values()].map(({ manifest, protected: isProtected }) => ({
      id: manifest.id,
      title: manifest.title,
      publisher: manifest.publisher,
      protected: isProtected,
      running: running.has(manifest.id),
    }));
  },
  onLaunchApp(appId) {
    return open(appId);
  },
  onGetWidgets() {
    return [...apps.values()].flatMap(({ manifest }) =>
      (manifest.widgets ?? []).flatMap((w) => {
        const descriptor = widgets.get(manifest.id)?.[w.id];
        return descriptor ? [{ appId: manifest.id, widgetId: w.id, title: w.title, descriptor }] : [];
      })
    );
  },
});

function publish() {
  if (!win) return;
  win.webContents.send('host:state', {
    product: product.name,
    active,
    title: active ? running.get(active)?.title : product.name,
    accounts: identity.listAccounts(),
    activeAccount: identity.getActiveAccount(),
    apps: [...apps.values()].map(({ manifest, protected: isProtected }) => ({
      id: manifest.id, title: manifest.title, publisher: manifest.publisher, protected: isProtected, running: running.has(manifest.id),
    })),
    widgets: [...apps.values()].flatMap(({ manifest }) =>
      (manifest.widgets ?? []).flatMap((w) => {
        const descriptor = widgets.get(manifest.id)?.[w.id];
        return descriptor ? [{ appId: manifest.id, widgetId: w.id, title: w.title, descriptor }] : [];
      })),
    manager: { ...manager.rows(), actionError: managerError, pendingInstall },
  });
}

/**
 * Runs an install, update, rollback or removal: the app is stopped first, so it never
 * runs from files that are being replaced, and the app list is reloaded afterwards.
 * @param {string} appId
 * @param {() => unknown} action
 */
async function manage(appId, action) {
  if (apps.get(appId)?.protected) { managerError = `${appId} is a core app`; publish(); return; }
  stop(appId);
  try {
    await action();
    managerError = null;
  } catch (error) {
    managerError = `${appId}: ${error instanceof Error ? error.message : String(error)}`;
    hostLog(`manage ${managerError}`);
  }
  apps = loadApps(product, appsRoot, manager.installed(), hostLog);
  publish();
}

function layout() {
  if (!win) return;
  const [width, height] = win.getContentSize();
  for (const [id, { view }] of running) {
    view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT });
    view.setVisible(id === active);
  }
}

/** @param {string} appId */
function open(appId) {
  const installed = apps.get(appId);
  if (!installed || !win) return false;
  if (!running.has(appId)) {
    const view = createAppView(installed, appLog(appId));
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
  if (active === appId) active = null;
  layout();
  publish();
}

/** Asks the app first; it may veto within CLOSE_VETO_TIMEOUT_MS. @param {string} appId */
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

/** Opens `<protocol>://<app-id>/<path>` links. @param {string} link */
function handleLink(link) {
  let url;
  try { url = new URL(link); } catch { return; }
  if (url.protocol !== `${product.protocol}:`) return;
  // `_` is the shell itself (never a valid app id): <protocol>://_/install/<app-id>
  const install = url.host === '_' && /^\/install\/([a-z][a-z0-9.-]{0,63})$/.exec(url.pathname);
  if (install) { requestInstall(install[1]); return; }
  if (!open(url.host)) return;
  const wc = running.get(url.host)?.view.webContents;
  const send = () => wc?.send('appshell:event', 'shell.deepLink', { path: url.pathname + url.search });
  if (wc?.isLoading()) wc.once('did-finish-load', send); else send();
}

/**
 * Install links (e.g. from a store web page) only ask: the user confirms in the host,
 * and only apps from the product's own catalog can be installed.
 * @param {string} appId
 */
async function requestInstall(appId) {
  await manager.refresh();
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

/** Accepts host IPC only from the host UI. @param {Electron.IpcMainInvokeEvent} event */
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
  return manage(id, () => manager.install(id));
});
ipcMain.handle('host:dismissInstall', (event) => { if (fromHost(event)) { pendingInstall = null; publish(); } });
ipcMain.handle('host:rollback', (event, id) => fromHost(event) && manage(id, () => manager.rollback(id)));
ipcMain.handle('host:uninstall', (event, id) => fromHost(event) && manage(id, async () => {
  manager.uninstall(id);
  services.removeAppData(id);
  await session.fromPartition(`persist:app:${id}`).clearStorageData();
}));
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
ipcMain.handle('host:widgetAction', (event, appId, widgetId, actionId) => {
  if (!fromHost(event)) return;
  const descriptor = /** @type {any} */ (widgets.get(appId)?.[widgetId]);
  const declared = descriptor?.blocks?.some((/** @type {any} */ b) => b.type === 'actions' && b.actions.some((/** @type {any} */ a) => a.id === actionId));
  if (!declared || !open(appId)) return;
  running.get(appId)?.view.webContents.send('appshell:event', 'widgets.action', { widget: widgetId, action: actionId });
});
ipcMain.handle('host:accounts:switch', (event, id) => {
  if (!fromHost(event)) return;
  identity.switchAccount(id);
  publish();
});
ipcMain.handle('host:accounts:add', (event, data) => {
  if (!fromHost(event)) return;
  identity.addAccount(data);
  publish();
});
ipcMain.handle('host:accounts:remove', (event, id) => {
  if (!fromHost(event)) return;
  identity.removeAccount(id);
  publish();
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
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: product.name,
    autoHideMenuBar: true,
    webPreferences: { preload: HOST_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.on('resize', layout);
  win.on('closed', () => { win = null; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => { if (e.level === 'error') hostLog(`host ui: ${e.message}`); });
  win.webContents.on('preload-error', (_e, file, error) => hostLog(`host preload ${file}: ${error.message}`));
  await win.loadFile(HOST_UI);
  hostLog(`started ${product.name} with ${apps.size} app(s)`);
  manager.refresh().then(publish);
  links(process.argv).forEach(handleLink);

  // D13: Guaranteed fallback emergency hotkey to restore default shell dashboard
  globalShortcut.register('CommandOrControl+Shift+Escape', () => {
    active = null;
    layout();
    publish();
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  // Phase 2: Automatic periodic background catalog update checks
  setInterval(() => manager.refresh().then(publish), 60 * 60 * 1000).unref();
});
