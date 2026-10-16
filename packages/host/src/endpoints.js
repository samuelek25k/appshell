import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_PER_APP = 8;

/** @param {() => string} rootOf */
export function createEndpoints(rootOf) {
  const file = () => join(rootOf(), 'endpoints.json');

  /** @returns {Record<string, string[]>} */
  function read() {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8'));
      return Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, /** @type {string[]} */ (v).filter((x) => typeof x === 'string')]));
    } catch {
      return {};
    }
  }

  /** @param {Record<string, string[]>} next */
  function write(next) {
    mkdirSync(rootOf(), { recursive: true });
    writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  return {
    /** @param {string} appId */
    list: (appId) => read()[appId] ?? [],

    all: read,

    /**
     * @param {string} appId
     * @param {string} key
     */
    add(appId, key) {
      const all = read();
      const current = all[appId] ?? [];
      if (current.includes(key)) return;
      if (current.length >= MAX_PER_APP) throw new Error(`at most ${MAX_PER_APP} approved addresses per app`);
      write({ ...all, [appId]: [...current, key] });
    },

    /**
     * @param {string} appId
     * @param {string} key
     */
    remove(appId, key) {
      const all = read();
      const left = (all[appId] ?? []).filter((x) => x !== key);
      if (left.length) all[appId] = left; else delete all[appId];
      write(all);
    },
  };
}

/**
 * @param {string[]} roots
 * @param {string} appId
 */
export function forgetApp(roots, appId) {
  for (const root of roots) {
    const store = createEndpoints(() => root);
    for (const key of store.list(appId)) store.remove(appId, key);
  }
}
