import { WebContentsView, session } from 'electron';
import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopback, networkAllowed, parseEndpoint } from '@appshell/contracts';
import { isInside } from './registry.js';

const SDK_FILE = createRequire(import.meta.url).resolve('@appshell/sdk');
const SHARED_FILES = /** @type {Record<string, string>} */ ({
  '/__appshell/sdk.js': SDK_FILE,
  '/__appshell/ui.css': fileURLToPath(new URL('../../sdk/ui.css', import.meta.url)),
});
const APP_PRELOAD = fileURLToPath(new URL('../preload/app.cjs', import.meta.url));

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

/** @param {import('@appshell/contracts').Manifest} m */
const csp = (m) => {
  const declared = (m.capabilities?.network ?? []).map((h) => {
    if (isLoopback(h)) {
      const hasPort = h.startsWith('[') ? h.includes(']:') : h.includes(':');
      if (hasPort) return `http://${h} ws://${h} https://${h} wss://${h}`;
      return `http://${h}:* ws://${h}:* https://${h}:* wss://${h}:* http://${h} ws://${h} https://${h} wss://${h}`;
    }
    return `https://${h} wss://${h}`;
  }).join(' ');
  const hosts = m.capabilities?.userEndpoints ? 'http: https: ws: wss:' : declared;
  return [
    `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`,
    `connect-src 'self' ${hosts}`.trim(), `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  ].join('; ');
};

/** @type {Set<string>} */
const prepared = new Set();

/**
 * @param {import('./registry.js').InstalledApp} app
 * @param {(level: string, message: string) => void} log
 * @param {string} partition
 * @param {() => string[]} approved
 */
function prepareSession(app, log, partition, approved) {
  const { id } = app.manifest;
  const ses = session.fromPartition(partition);
  if (prepared.has(partition)) return ses;
  prepared.add(partition);

  const rawAppDir = (realpathSync.native ?? realpathSync)(app.dir);
  const appDir = rawAppDir.startsWith('\\\\?\\') ? rawAppDir.slice(4) : rawAppDir;

  ses.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== id) {
      log('error', `protocol 404 for ${request.url}: host !== ${id}`);
      return new Response('Not found', { status: 404 });
    }
    let file;
    try {
      if (Object.hasOwn(SHARED_FILES, url.pathname)) file = SHARED_FILES[url.pathname];
      else {
        const resolved = await realpath(resolve(appDir, '.' + decodeURIComponent(url.pathname)));
        file = resolved.startsWith('\\\\?\\') ? resolved.slice(4) : resolved;
      }
    } catch (err) {
      log('error', `protocol 404 resolving ${request.url}: ${err instanceof Error ? err.message : String(err)}`);
      return new Response('Not found', { status: 404 });
    }
    if (!Object.values(SHARED_FILES).includes(file) && !isInside(appDir, file)) {
      log('error', `protocol 403 forbidden ${request.url}: file ${file} outside app.dir ${appDir}`);
      return new Response('Forbidden', { status: 403 });
    }
    try {
      return new Response(await readFile(file), {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'content-security-policy': csp(app.manifest),
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (err) {
      log('error', `protocol 404 reading ${file}: ${err instanceof Error ? err.message : String(err)}`);
      return new Response('Not found', { status: 404 });
    }
  });
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !networkAllowed(app.manifest, details.url, approved()) }));
  ses.webRequest.onHeadersReceived((details, callback) => {
    let u;
    try { u = new URL(details.url); } catch { return callback({ responseHeaders: details.responseHeaders }); }
    const key = parseEndpoint(details.url);
    if ((isLoopback(u.hostname) && networkAllowed(app.manifest, details.url)) || (key !== null && approved().includes(key))) {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['access-control-allow-origin'] = ['*'];
      responseHeaders['access-control-allow-headers'] = ['*'];
      responseHeaders['access-control-allow-methods'] = ['GET, POST, PUT, DELETE, OPTIONS, PATCH'];
      return callback({ responseHeaders });
    }
    callback({ responseHeaders: details.responseHeaders });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  return ses;
}

/**
 * @param {import('./registry.js').InstalledApp} app
 * @param {(level: string, message: string) => void} log
 * @param {string} partition
 * @param {() => string[]} [approved]
 */
export function createAppView(app, log, partition, approved = () => []) {
  const { id, entry } = app.manifest;
  const view = new WebContentsView({
    webPreferences: {
      session: prepareSession(app, log, partition, approved),
      preload: APP_PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });
  view.setBackgroundColor('#00000000');
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('did-fail-load', (_e, code, desc, url) => log('error', `did-fail-load ${code}: ${desc} (${url})`));
  wc.on('preload-error', (_e, file, err) => log('error', `preload-error in ${file}: ${err.message}`));
  wc.on('console-message', (e) => { if (e.level === 'error') log('error', `console: ${e.message}`); });
  const stayHome = (/** @type {Electron.Event} */ event, /** @type {string} */ url) => {
    const u = new URL(url);
    if (u.protocol !== 'app:' || u.host !== id) {
      event.preventDefault();
      log('warn', `blocked navigation to ${url}`);
    }
  };
  wc.on('will-navigate', stayHome);
  wc.on('will-redirect', stayHome);
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.loadURL(`app://${id}/${entry.ui ?? ''}`).catch((err) => log('error', `loadURL rejected: ${err.message}`));
  return view;
}
