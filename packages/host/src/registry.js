// Loads the product configuration and the app manifests it lists.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate } from '@appshell/contracts';
import { checkAppDir, isInside } from '@appshell/distribution';

/** @typedef {import('@appshell/contracts').Manifest} Manifest */
/** @typedef {{ name: string, protocol: string, dataDirectory: string, package: { extension: string, displayName: string }, catalog?: string, apps: { path: string, protected?: boolean }[], policy: { capabilities: 'warn' | 'enforce', developerMode?: boolean, allowedSources?: string[], channel?: 'stable' | 'beta' } }} Product */
/** @typedef {{ manifest: Manifest, dir: string, protected: boolean }} InstalledApp */

const HOST_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

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
 * Pre-installed apps from the product, then apps installed from the catalog.
 * Invalid apps are skipped and reported; a pre-installed app wins an id clash.
 * @param {Product} product
 * @param {string} appsRoot folder the product's app paths are relative to
 * @param {{ dir: string }[]} installed folders of current catalog installs
 * @param {(message: string) => void} report
 * @returns {Map<string, InstalledApp>}
 */
export function loadApps(product, appsRoot, installed, report) {
  /** @type {Map<string, InstalledApp>} */
  const apps = new Map();
  const add = (/** @type {string} */ where, /** @type {boolean} */ isProtected) => {
    try {
      const { dir, manifest } = checkAppDir(where, HOST_VERSION);
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

export { HOST_VERSION, isInside };
