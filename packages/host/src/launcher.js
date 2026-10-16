import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COLOR_KEYS } from '@appshell/contracts';

/** @typedef {{ launcher: string | null, colors: Record<string, string> }} Preferences */

/** @param {unknown} colors */
function cleanColors(colors) {
  /** @type {Record<string, string>} */
  const out = {};
  if (typeof colors !== 'object' || colors === null) return out;
  for (const key of THEME_COLOR_KEYS) {
    const value = /** @type {any} */ (colors)[key];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) out[key] = value;
  }
  return out;
}

/** @param {() => string} rootOf */
export function createLauncherPreferences(rootOf) {
  const file = () => join(rootOf(), 'launcher.json');

  /** @returns {Preferences} */
  function read() {
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8'));
      return { launcher: typeof raw.launcher === 'string' ? raw.launcher : null, colors: cleanColors(raw.colors) };
    } catch {
      return { launcher: null, colors: {} };
    }
  }

  /** @param {Preferences} next */
  function write(next) {
    mkdirSync(rootOf(), { recursive: true });
    writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  return {
    get: read,

    /** @param {string | null} launcher */
    setLauncher(launcher) {
      write({ ...read(), launcher });
    },

    /** @param {Record<string, string>} colors */
    setColors(colors) {
      write({ ...read(), colors: { ...read().colors, ...cleanColors(colors) } });
    },

    resetColors() {
      write({ ...read(), colors: {} });
    },
  };
}

/**
 * @param {Map<string, import('./registry.js').InstalledApp>} apps
 * @param {string | null} wanted
 * @param {string[]} [blocked]
 */
export function homeLauncher(apps, wanted, blocked = []) {
  if (!wanted || blocked.includes(wanted)) return null;
  const app = apps.get(wanted);
  return app?.manifest.kind === 'launcher' && app.manifest.capabilities?.launcher === true ? wanted : null;
}
