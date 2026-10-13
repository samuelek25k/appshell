// Per-app platform services. Every function takes the caller's app id from the bridge,
// never from the app, so one app cannot reach another's data.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage, Notification } from 'electron';

const MAX_VALUE_BYTES = 64 * 1024;
const MAX_STORE_BYTES = 1024 * 1024;

/** @param {string} root @param {string} appId */
const appDir = (root, appId) => {
  const dir = join(root, 'apps', appId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** @param {string} file @returns {Record<string, any>} */
const readStore = (file) => {
  // Null prototype, so keys such as "__proto__" stay plain data.
  try { return Object.assign(Object.create(null), JSON.parse(readFileSync(file, 'utf8'))); } catch { return Object.create(null); }
};

/** @param {string} code @param {string} message */
export const fail = (code, message) => Object.assign(new Error(message), { code });

/** @param {string} root data folder (userData) */
export function createServices(root) {
  const storeFile = (/** @type {string} */ id) => join(appDir(root, id), 'storage.json');
  const secretFile = (/** @type {string} */ id) => join(appDir(root, id), 'secrets.json');

  return {
    storage: {
      /** @param {string} id @param {string} key */
      get: (id, key) => readStore(storeFile(id))[key] ?? null,
      /** @param {string} id @param {string} key @param {unknown} value */
      set(id, key, value) {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || encoded.length > MAX_VALUE_BYTES) throw fail('INVALID_PARAMS', 'value must be JSON up to 64 KB');
        const store = readStore(storeFile(id));
        store[key] = value;
        const next = JSON.stringify(store);
        if (next.length > MAX_STORE_BYTES) throw fail('INVALID_PARAMS', 'app storage is limited to 1 MB');
        writeFileSync(storeFile(id), next);
        return null;
      },
      /** @param {string} id @param {string} key */
      remove(id, key) {
        const store = readStore(storeFile(id));
        delete store[key];
        writeFileSync(storeFile(id), JSON.stringify(store));
        return null;
      },
    },

    secrets: {
      /** @param {boolean} developerMode */
      assertAvailable(developerMode) {
        if (!safeStorage.isEncryptionAvailable()) throw fail('BACKEND_UNAVAILABLE', 'OS secure storage is unavailable');
        // Linux without a keyring falls back to obfuscation only; allow it in developer mode alone.
        if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text' && !developerMode) {
          throw fail('BACKEND_UNAVAILABLE', 'no OS keyring; secrets are disabled outside developer mode');
        }
      },
      /** @param {string} id @param {string} name */
      get(id, name) {
        const value = readStore(secretFile(id))[name];
        return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : null;
      },
      /** @param {string} id @param {string} name @param {string} value */
      set(id, name, value) {
        const store = readStore(secretFile(id));
        store[name] = safeStorage.encryptString(value).toString('base64');
        writeFileSync(secretFile(id), JSON.stringify(store));
        return null;
      },
    },

    /** @param {string} id @param {string} level @param {string} message */
    log(id, level, message) {
      mkdirSync(join(root, 'logs'), { recursive: true });
      appendFileSync(join(root, 'logs', `${id}.log`), JSON.stringify({ t: new Date().toISOString(), level, message }) + '\n');
      return null;
    },

    /** @param {string} title @param {string | undefined} body */
    notify(title, body) {
      if (Notification.isSupported()) new Notification({ title, body }).show();
      return null;
    },

    /** Removes an app's data on uninstall. @param {string} id */
    removeAppData: (id) => rmSync(join(root, 'apps', id), { recursive: true, force: true }),
  };
}
