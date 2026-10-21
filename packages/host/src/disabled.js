import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {() => string} rootOf */
export function createDisabledApps(rootOf) {
  const file = () => join(rootOf(), 'disabled.json');

  /** @returns {string[]} */
  function read() {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8'));
      return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  return {
    list: read,

    /** @param {string} appId */
    has: (appId) => read().includes(appId),

    /**
     * @param {string} appId
     * @param {boolean} disabled
     */
    set(appId, disabled) {
      const rest = read().filter((x) => x !== appId);
      mkdirSync(rootOf(), { recursive: true });
      writeFileSync(file(), JSON.stringify(disabled ? [...rest, appId] : rest), { mode: 0o600 });
    },
  };
}

/**
 * @param {string[]} roots
 * @param {string} appId
 */
export function forgetDisabled(roots, appId) {
  for (const root of roots) createDisabledApps(() => root).set(appId, false);
}
