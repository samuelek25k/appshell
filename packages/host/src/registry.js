import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate } from '@appshell/contracts';
import { checkAppDir, isInside } from '@appshell/distribution';

/** @typedef {import('@appshell/contracts').Manifest} Manifest */
/** @typedef {{ name: string, protocol: string, dataDirectory: string, package: { extension: string, displayName: string }, catalog?: string, defaultLocale?: string, supportedLocales?: string[], apps: { path: string, protected?: boolean }[], policy: { capabilities?: 'warn' | 'enforce', developerMode?: boolean, allowedSources?: string[], channel?: 'stable' | 'beta', blockedApps?: string[], requireReview?: boolean } }} Product */
/** @typedef {{ manifest: Manifest, dir: string, protected: boolean }} InstalledApp */

const ENGINE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).appshell.engine;

/** @param {string} file */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * @param {string} productFile
 * @returns {Product}
 */
export function loadProduct(productFile) {
  const product = readJson(productFile);
  const result = validate('product', product);
  if (!result.ok) throw new Error(`Invalid product config ${productFile}: ${result.errors.join('; ')}`);
  return product;
}

/**
 * @param {Product} product
 * @param {string} appsRoot
 * @param {{ dir: string }[]} installed
 * @param {(message: string) => void} report
 * @returns {Map<string, InstalledApp>}
 */
export function loadApps(product, appsRoot, installed, report) {
  /** @type {Map<string, InstalledApp>} */
  const apps = new Map();
  const add = (/** @type {string} */ where, /** @type {boolean} */ isProtected) => {
    try {
      const { dir, manifest } = checkAppDir(where, ENGINE_VERSION);
      if (apps.has(manifest.id)) throw new Error(`duplicate app id ${manifest.id}`);
      apps.set(manifest.id, { manifest, dir, protected: isProtected });
    } catch (error) {
      report(`Skipped app at ${where}: ${error instanceof Error ? error.message : error}`);
    }
  };
  for (const entry of product.apps) add(resolve(appsRoot, entry.path), entry.protected === true);
  for (const entry of installed) add(entry.dir, false);
  return apps;
}

export { ENGINE_VERSION, isInside };
