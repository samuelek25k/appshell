import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_SOURCES } from '@appshell/contracts';

/**
 * @param {string} dataRoot
 * @param {Electron.NativeTheme} nativeTheme
 * @param {(message: string) => void} log
 */
export function createSettings(dataRoot, nativeTheme, log) {
  const file = join(dataRoot, 'settings.json');
  /** @type {{ theme?: 'system' | 'light' | 'dark' }} */
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  if (settings.theme && THEME_SOURCES.includes(settings.theme)) nativeTheme.themeSource = settings.theme;

  return {
    /** @param {'system' | 'light' | 'dark'} theme */
    setTheme(theme) {
      if (!THEME_SOURCES.includes(theme)) return false;
      nativeTheme.themeSource = theme;
      settings.theme = theme;
      try {
        writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
      } catch (error) {
        log(`failed to save settings: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    },
  };
}
