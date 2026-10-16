import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
const electron = process.versions.electron
  ? await import('electron').then((m) => m.default ?? m).catch(() => null)
  : null;

const safeStorage = typeof electron === 'object' && electron !== null && 'safeStorage' in electron
  ? electron.safeStorage
  : /** @type {any} */ ({
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'none',
    encryptString: (/** @type {string} */ s) => Buffer.from(s),
    decryptString: (/** @type {Buffer} */ b) => b.toString(),
  });

const Notification = typeof electron === 'object' && electron !== null && 'Notification' in electron
  ? electron.Notification
  : /** @type {any} */ (class {
    /** @param {{ title: string, body?: string }} _opts */
    constructor(_opts) {}
    static isSupported() { return false; }
    show() {}
  });

const MAX_VALUE_BYTES = 64 * 1024;
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** @param {string} file @param {string} line */
export function appendWithRotation(file, line) {
  try {
    if (existsSync(file) && statSync(file).size >= MAX_LOG_BYTES) {
      const rotated = file.replace(/\.log$/, '.1.log');
      renameSync(file, rotated);
    }
  } catch {}
  appendFileSync(file, line);
}

/** @param {string} root @param {string} appId */
const appDir = (root, appId) => {
  const dir = join(root, 'apps', appId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** @param {string} code @param {string} message */
export const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * @param {string | (() => string)} rootOf
 * @param {string} [auditRoot]
 */
export function createServices(rootOf, auditRoot) {
  const root = () => (typeof rootOf === 'function' ? rootOf() : rootOf);
  const storeFile = (/** @type {string} */ id) => join(appDir(root(), id), 'storage.json');
  const secretFile = (/** @type {string} */ id) => join(appDir(root(), id), 'secrets.json');
  /** @param {string} id */
  const readStore = (id) => {
    try {
      return Object.assign(Object.create(null), JSON.parse(readFileSync(storeFile(id), 'utf8')));
    } catch {
      return Object.create(null);
    }
  };

  /** @param {string} id @param {Record<string, unknown>} store */
  const writeStore = (id, store) => {
    const next = JSON.stringify(store);
    if (next.length > MAX_STORE_BYTES) throw fail('INVALID_PARAMS', 'app storage is limited to 1 MB');
    writeFileSync(storeFile(id), next);
  };

  return {
    storage: {
      /** @param {string} id @param {string} key */
      get: (id, key) => readStore(id)[key] ?? null,
      /** @param {string} id @param {string} key @param {unknown} value */
      set(id, key, value) {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || encoded.length > MAX_VALUE_BYTES) throw fail('INVALID_PARAMS', 'value must be JSON up to 64 KB');
        const store = readStore(id);
        store[key] = value;
        writeStore(id, store);
        return null;
      },
      /** @param {string} id @param {string} key */
      remove(id, key) {
        const store = readStore(id);
        delete store[key];
        writeStore(id, store);
        return null;
      },
    },

    secrets: {
      /** @param {boolean} developerMode */
      assertAvailable(developerMode) {
        if (!safeStorage.isEncryptionAvailable()) throw fail('BACKEND_UNAVAILABLE', 'OS secure storage is unavailable');
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
      mkdirSync(join(root(), 'logs'), { recursive: true });
      appendWithRotation(join(root(), 'logs', `${id}.log`), JSON.stringify({ t: new Date().toISOString(), level, message }) + '\n');
      return null;
    },

    /**
     * @param {{ event: string, actor?: string, target?: string, details?: Record<string, any> }} entry
     */
    audit(entry) {
      const dir = join(auditRoot ?? root(), 'logs');
      mkdirSync(dir, { recursive: true });
      const record = { t: new Date().toISOString(), ...entry };
      appendWithRotation(join(dir, 'audit.log'), JSON.stringify(record) + '\n');
      return record;
    },

    /** @param {string} title @param {string | undefined} body */
    notify(title, body) {
      if (Notification.isSupported()) new Notification({ title, body }).show();
      return null;
    },

    /** @param {string} id @param {string[]} [roots] */
    removeAppData: (id, roots = [root()]) => roots.forEach((r) => rmSync(join(r, 'apps', id), { recursive: true, force: true })),
    /** @param {string} id @param {string[]} [roots] */
    removeAppLogs: (id, roots = [root()]) => roots.forEach((r) => {
      rmSync(join(r, 'logs', `${id}.log`), { force: true });
      rmSync(join(r, 'logs', `${id}.1.log`), { force: true });
    }),
  };
}
