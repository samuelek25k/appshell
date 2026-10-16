// Per-app platform services. Every function takes the caller's app id from the bridge,
// never from the app, so one app cannot reach another's data.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import electron from 'electron';

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

/** @param {string} root @param {string} appId */
const appDir = (root, appId) => {
  const dir = join(root, 'apps', appId);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** @param {string} code @param {string} message */
export const fail = (code, message) => Object.assign(new Error(message), { code });

/** @param {string} root data folder (userData) */
export function createServices(root) {
  const storeFile = (/** @type {string} */ id) => join(appDir(root, id), 'storage.json');
  const secretFile = (/** @type {string} */ id) => join(appDir(root, id), 'secrets.json');
  const masterKeyFile = join(root, 'storage.key');

  /** @type {Buffer | null} */
  let masterKeyCache = null;
  const getMasterKey = () => {
    if (masterKeyCache) return masterKeyCache;
    try {
      if (existsSync(masterKeyFile)) {
        masterKeyCache = readFileSync(masterKeyFile);
      } else {
        masterKeyCache = randomBytes(32);
        writeFileSync(masterKeyFile, masterKeyCache, { mode: 0o600 });
      }
    } catch {
      masterKeyCache = randomBytes(32);
    }
    return masterKeyCache;
  };

  /** @param {string} id */
  const getAppKey = (id) =>
    Buffer.from(hkdfSync('sha256', getMasterKey(), Buffer.from(id), Buffer.from('appshell-storage-v1'), 32));

  /** @param {string} data @param {Buffer} key */
  const encryptStorage = (data, key) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      __appshell_encrypted__: true,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: enc.toString('base64'),
    });
  };

  /** @param {string} raw @param {Buffer} key */
  const decryptStorage = (raw, key) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__appshell_encrypted__) {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
        decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
        const dec = Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64')), decipher.final()]);
        return Object.assign(Object.create(null), JSON.parse(dec.toString('utf8')));
      }
      return Object.assign(Object.create(null), parsed);
    } catch {
      return Object.create(null);
    }
  };

  /** @param {string} id @param {boolean} [secure] */
  const readStore = (id, secure = false) => {
    const file = storeFile(id);
    try {
      const content = readFileSync(file, 'utf8');
      if (secure || content.includes('__appshell_encrypted__')) {
        return decryptStorage(content, getAppKey(id));
      }
      return Object.assign(Object.create(null), JSON.parse(content));
    } catch {
      return Object.create(null);
    }
  };

  /** @param {string} id @param {Record<string, any>} store @param {boolean} [secure] */
  const writeStore = (id, store, secure = false) => {
    const next = JSON.stringify(store);
    if (next.length > MAX_STORE_BYTES) throw fail('INVALID_PARAMS', 'app storage is limited to 1 MB');
    const file = storeFile(id);
    if (secure) {
      writeFileSync(file, encryptStorage(next, getAppKey(id)), { mode: 0o600 });
    } else {
      writeFileSync(file, next);
    }
  };

  return {
    storage: {
      /** @param {string} id @param {string} key @param {boolean} [secure] */
      get: (id, key, secure = false) => readStore(id, secure)[key] ?? null,
      /** @param {string} id @param {string} key @param {unknown} value @param {boolean} [secure] */
      set(id, key, value, secure = false) {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || encoded.length > MAX_VALUE_BYTES) throw fail('INVALID_PARAMS', 'value must be JSON up to 64 KB');
        const store = readStore(id, secure);
        store[key] = value;
        writeStore(id, store, secure);
        return null;
      },
      /** @param {string} id @param {string} key @param {boolean} [secure] */
      remove(id, key, secure = false) {
        const store = readStore(id, secure);
        delete store[key];
        writeStore(id, store, secure);
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

    /**
     * Records an administrative, security, or lifecycle event to the audit log.
     * @param {{ event: string, actor?: string, target?: string, details?: Record<string, any> }} entry
     */
    audit(entry) {
      mkdirSync(join(root, 'logs'), { recursive: true });
      const record = { t: new Date().toISOString(), ...entry };
      appendFileSync(join(root, 'logs', 'audit.log'), JSON.stringify(record) + '\n');
      return record;
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
