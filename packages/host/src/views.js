import { WebContentsView, session } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkAllowed } from '@appshell/contracts';
import { isInside } from './registry.js';

const SDK_FILE = createRequire(import.meta.url).resolve('@appshell/sdk');
const APP_PRELOAD = fileURLToPath(new URL('../preload/app.cjs', import.meta.url));

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

/** @param {import('@appshell/contracts').Manifest} m */
const csp = (m) => {
  const hosts = (m.capabilities?.network ?? []).map((h) => `https://${h} wss://${h}`).join(' ');
  return [
    `default-src 'self'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`,
    `connect-src 'self' ${hosts}`.trim(), `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  ].join('; ');
};

/** @type {Set<string>} */
const prepared = new Set();

/** @param {import('./registry.js').InstalledApp} app */
function prepareSession(app) {
  const { id } = app.manifest;
  const ses = session.fromPartition(`persist:app:${id}`);
  if (prepared.has(id)) return ses;
  prepared.add(id);

  ses.protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== id) return new Response('Not found', { status: 404 });
    let file;
    try {
      if (url.pathname === '/__appshell/sdk.js') file = SDK_FILE;
      else {
        const baseDir = app.dir.startsWith('\\\\?\\') ? app.dir.slice(4) : app.dir;
        const resolved = await realpath(resolve(baseDir, '.' + decodeURIComponent(url.pathname)));
        file = resolved.startsWith('\\\\?\\') ? resolved.slice(4) : resolved;
      }
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (file !== SDK_FILE && !isInside(app.dir, file)) return new Response('Forbidden', { status: 403 });
    try {
      return new Response(await readFile(file), {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'content-security-policy': csp(app.manifest),
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !networkAllowed(app.manifest, details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  return ses;
}

/**
 * @param {import('./registry.js').InstalledApp} app
 * @param {(level: string, message: string) => void} log
 */
export function createAppView(app, log) {
  const { id, entry } = app.manifest;
  const view = new WebContentsView({
    webPreferences: {
      session: prepareSession(app),
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
  wc.loadURL(`app://${id}/${entry.ui ?? ''}`);
  return view;
}
