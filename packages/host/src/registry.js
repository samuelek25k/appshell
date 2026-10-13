// Loads the product configuration and the app manifests it lists.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { validate, satisfiesEngine } from '@appshell/contracts';

/** @typedef {import('@appshell/contracts').Manifest} Manifest */
/** @typedef {{ name: string, protocol: string, dataDirectory: string, package: { extension: string, displayName: string }, catalog?: string, apps: { path: string, protected?: boolean }[], policy: { capabilities: 'warn' | 'enforce', developerMode?: boolean } }} Product */
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
 * True when `child` resolves inside `parent`. Used for every app file path.
 * @param {string} parent
 * @param {string} child
 */
export function isInside(parent, child) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Reads and validates each app listed by the product. Invalid apps are skipped and reported.
 * @param {Product} product
 * @param {string} appsRoot folder the product's app paths are relative to
 * @param {(message: string) => void} report
 * @returns {Map<string, InstalledApp>}
 */
export function loadApps(product, appsRoot, report) {
  /** @type {Map<string, InstalledApp>} */
  const apps = new Map();
  for (const entry of product.apps) {
    const where = resolve(appsRoot, entry.path);
    try {
      const dir = realpathSync(where);
      const manifest = readJson(resolve(dir, 'manifest.json'));
      const result = validate('manifest', manifest);
      if (!result.ok) throw new Error(result.errors.join('; '));
      if (!satisfiesEngine(manifest.engines.appshell, HOST_VERSION)) {
        throw new Error(`needs appshell ${manifest.engines.appshell}, host is ${HOST_VERSION}`);
      }
      for (const file of Object.values(manifest.entry)) {
        const full = resolve(dir, file);
        if (!isInside(dir, full) || !existsSync(full)) throw new Error(`entry ${file} missing or outside the app folder`);
      }
      if (apps.has(manifest.id)) throw new Error(`duplicate app id ${manifest.id}`);
      apps.set(manifest.id, { manifest, dir, protected: entry.protected === true });
    } catch (error) {
      report(`Skipped app at ${where}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return apps;
}

export { HOST_VERSION };
