// Appshell host entry. Usage in development:
//   electron packages/host --product <product.json> [--apps <dir>] [--user-data <dir>] [<protocol>://<app-id>/<path>]
import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_VETO_TIMEOUT_MS } from '@appshell/contracts';
import { loadProduct, loadApps } from './registry.js';
import { createServices } from './services.js';
import { createBackend } from './backend.js';
import { createBridge } from './bridge.js';
import { createAppView } from './views.js';

const CHROME_HEIGHT = 48;
const HOST_UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const HOST_PRELOAD = fileURLToPath(new URL('../preload/host.cjs', import.meta.url));

/** @param {string} name */
const flag = (name) => {
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

const apps = loadApps(product, appsRoot, hostLog);
const services = createServices(dataRoot);

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

const bridge = createBridge({
  policy: product.policy,
  services,
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
});

function publish() {
  if (!win) return;
  win.webContents.send('host:state', {
    product: product.name,
    active,
    title: active ? running.get(active)?.title : product.name,
    apps: [...apps.values()].map(({ manifest, protected: isProtected }) => ({
      id: manifest.id, title: manifest.title, publisher: manifest.publisher, protected: isProtected, running: running.has(manifest.id),
    })),
    widgets: [...apps.values()].flatMap(({ manifest }) =>
      (manifest.widgets ?? []).flatMap((w) => {
        const descriptor = widgets.get(manifest.id)?.[w.id];
        return descriptor ? [{ appId: manifest.id, widgetId: w.id, title: w.title, descriptor }] : [];
      })),
  });
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
  if (url.protocol !== `${product.protocol}:` || !open(url.host)) return;
  const wc = running.get(url.host)?.view.webContents;
  const send = () => wc?.send('appshell:event', 'shell.deepLink', { path: url.pathname + url.search });
  if (wc?.isLoading()) wc.once('did-finish-load', send); else send();
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
  links(process.argv).forEach(handleLink);
});
