import { utilityProcess } from 'electron';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './services.js';

const CALL_TIMEOUT_MS = 10_000;
const IDLE_MS = 60_000;
const MAX_RESTARTS = 3;
const rawPreload = (realpathSync.native ?? realpathSync)(fileURLToPath(new URL('../preload/backend.cjs', import.meta.url)));
const BACKEND_PRELOAD = rawPreload.startsWith('\\\\?\\') ? rawPreload.slice(4) : rawPreload;

/**
 * @param {import('./registry.js').InstalledApp} app
 * @param {(level: string, message: string) => void} log
 */
export function createBackend(app, log) {
  const rawAppDir = (realpathSync.native ?? realpathSync)(app.dir);
  const appDir = rawAppDir.startsWith('\\\\?\\') ? rawAppDir.slice(4) : rawAppDir;
  const { id, entry } = app.manifest;
  const file = resolve(appDir, /** @type {string} */ (entry.backend));
  /** @type {Electron.UtilityProcess | null} */
  let child = null;
  let crashes = 0;
  let nextId = 0;
  /** @type {NodeJS.Timeout | undefined} */
  let idle;
  /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();

  const networkHosts = (app.manifest.capabilities?.network ?? []).join(',');
  const env = {
    NODE_OPTIONS: `--permission --allow-fs-read="${appDir.replaceAll('\\', '\\\\')}" --allow-fs-read="${BACKEND_PRELOAD.replaceAll('\\', '\\\\')}" --require="${BACKEND_PRELOAD.replaceAll('\\', '\\\\')}"`,
    APPSHELL_APP_ID: id,
    APPSHELL_ALLOWED_HOSTS: networkHosts,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };

  function start() {
    const proc = utilityProcess.fork(file, [], { serviceName: `app:${id}`, stdio: 'pipe', cwd: appDir, env });
    proc.stdout?.on('data', (d) => log('info', String(d).trimEnd()));
    proc.stderr?.on('data', (d) => log('error', String(d).trimEnd()));
    proc.on('message', (/** @type {any} */ msg) => {
      const call = pending.get(msg?.id);
      if (!call) return;
      pending.delete(msg.id);
      clearTimeout(call.timer);
      if (msg.error) call.reject(fail(msg.error.code === 'UNKNOWN_METHOD' ? 'UNKNOWN_METHOD' : 'BACKEND_ERROR', String(msg.error.message)));
      else call.resolve(msg.result ?? null);
    });
    proc.on('exit', (code) => {
      if (child !== proc) return;
      child = null;
      if (code !== 0) crashes += 1;
      for (const [key, call] of pending) {
        clearTimeout(call.timer);
        call.reject(fail('BACKEND_UNAVAILABLE', `backend exited with code ${code}`));
        pending.delete(key);
      }
    });
    return proc;
  }

  return {
    /** @param {string} method @param {unknown} params */
    call(method, params) {
      if (crashes > MAX_RESTARTS) return Promise.reject(fail('BACKEND_UNAVAILABLE', 'backend crashed too often'));
      child ??= start();
      clearTimeout(idle);
      idle = setTimeout(() => this.stop(), IDLE_MS);
      const callId = ++nextId;
      const proc = child;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(callId);
          reject(fail('BACKEND_TIMEOUT', `${method} took longer than ${CALL_TIMEOUT_MS} ms`));
        }, CALL_TIMEOUT_MS);
        pending.set(callId, { resolve, reject, timer });
        proc.postMessage({ id: callId, method, params: params ?? {} });
      });
    },
    stop() {
      clearTimeout(idle);
      const proc = child;
      child = null;
      proc?.kill();
    },
  };
}
