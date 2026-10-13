// App packages, catalog resolution and the installed-app store. Plain Node, no Electron,
// so the CLI, the host and tests share one implementation.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tar from 'tar';
import { validate, satisfiesEngine } from '@appshell/contracts';

/** @typedef {import('@appshell/contracts').Manifest} Manifest */
/** @typedef {{ version: string, channel: 'stable' | 'beta', url: string, sha256: string, commit: string }} Release */
/** @typedef {{ id: string, title: string, publisher: string, repository: string, releases: Release[] }} CatalogEntry */
/** @typedef {{ id: string, version: string, repository: string, url: string, sha256: string, commit: string, installedAt: string }} Provenance */

const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

/** @param {string} code @param {string} message */
const fail = (code, message) => Object.assign(new Error(message), { code });

/** @param {string} parent @param {string} child */
export const isInside = (parent, child) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Validates an app folder: manifest schema, engine range, entries inside the folder.
 * @param {string} where
 * @param {string} hostVersion
 * @returns {{ dir: string, manifest: Manifest }}
 */
export function checkAppDir(where, hostVersion) {
  const dir = realpathSync(where);
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
  const result = validate('manifest', manifest);
  if (!result.ok) throw fail('INVALID_MANIFEST', result.errors.join('; '));
  if (!satisfiesEngine(manifest.engines.appshell, hostVersion)) {
    throw fail('INCOMPATIBLE', `needs appshell ${manifest.engines.appshell}, host is ${hostVersion}`);
  }
  for (const file of Object.values(manifest.entry)) {
    const full = resolve(dir, file);
    if (!isInside(dir, full) || !existsSync(full)) throw fail('INVALID_MANIFEST', `entry ${file} missing or outside the app folder`);
  }
  return { dir, manifest };
}

/**
 * Packs an app folder into a gzipped tar of regular files. Returns the package digest.
 * @param {string} appDir
 * @param {string} outFile
 * @param {string} hostVersion
 */
export async function pack(appDir, outFile, hostVersion) {
  const { dir, manifest } = checkAppDir(appDir, hostVersion);
  await tar.c({
    gzip: true, file: outFile, cwd: dir, portable: true, noMtime: true,
    filter: (path, stat) => {
      const s = /** @type {import('node:fs').Stats} */ (stat);
      return !path.split(/[\\/]/).includes('.git') && (s.isFile() || s.isDirectory());
    },
  }, ['.']);
  return { manifest, sha256: sha256(readFileSync(outFile)) };
}

/**
 * Picks the newest release a channel may see. Beta sees stable and beta.
 * @param {CatalogEntry} entry
 * @param {'stable' | 'beta'} channel
 * @returns {Release | undefined}
 */
export function latestRelease(entry, channel) {
  const allowed = entry.releases.filter((r) => channel === 'beta' || r.channel === 'stable');
  return allowed.sort((a, b) => compareVersions(b.version, a.version))[0];
}

/** Semver precedence: numbers, then a prerelease sorts before its release. @param {string} a @param {string} b */
export function compareVersions(a, b) {
  const [ca, pa = ''] = a.split('-', 2);
  const [cb, pb = ''] = b.split('-', 2);
  const na = ca.split('.').map(Number);
  const nb = cb.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] - nb[i];
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

/**
 * True when a URL may be used as a package source under the product policy.
 * @param {string} url
 * @param {{ allowedSources?: string[], developerMode?: boolean }} policy
 */
export function sourceAllowed(url, policy) {
  if (url.startsWith('file://')) return policy.developerMode === true;
  return url.startsWith('https://') && (policy.allowedSources ?? []).some((prefix) => url.startsWith(prefix));
}

/**
 * Parses and validates a catalog document.
 * @param {string} text
 * @returns {CatalogEntry[]}
 */
export function parseCatalog(text) {
  const catalog = JSON.parse(text);
  const result = validate('catalog', catalog);
  if (!result.ok) throw fail('INVALID_CATALOG', result.errors.join('; '));
  return catalog.apps;
}

/** Reads a URL as bytes; file:// via the filesystem, anything else via the given fetch. */
export async function readUrl(/** @type {string} */ url, /** @type {typeof fetch} */ fetchImpl = fetch) {
  if (url.startsWith('file://')) return new Uint8Array(await readFile(fileURLToPath(url)));
  const response = await fetchImpl(url);
  if (!response.ok) throw fail('DOWNLOAD_FAILED', `${url} answered ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_PACKAGE_BYTES) throw fail('DOWNLOAD_FAILED', 'package exceeds 100 MB');
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Installed apps live in <root>/<id>/<version>/ with provenance in <root>/installed.json.
 * The previous version stays on disk so a rollback needs no download.
 * @param {string} root
 */
export function createStore(root) {
  const stateFile = join(root, 'installed.json');
  /** @returns {Record<string, { current: Provenance, previous: Provenance | null }>} */
  const read = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  const write = (/** @type {object} */ state) => { mkdirSync(root, { recursive: true }); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };
  const dirOf = (/** @type {Provenance} */ p) => join(root, p.id, p.version);

  return {
    list: () => Object.values(read()).map((s) => ({ ...s, dir: dirOf(s.current) })),

    /**
     * Downloads, verifies and unpacks a release, then makes it current.
     * @param {CatalogEntry} entry
     * @param {Release} release
     * @param {{ hostVersion: string, policy: { allowedSources?: string[], developerMode?: boolean }, fetch?: typeof fetch }} options
     */
    async install(entry, release, options) {
      for (const url of [entry.repository, release.url]) {
        if (!sourceAllowed(url, options.policy)) throw fail('SOURCE_NOT_ALLOWED', `${url} is not an allowed source`);
      }
      const bytes = await readUrl(release.url, options.fetch);
      if (bytes.length > MAX_PACKAGE_BYTES) throw fail('DOWNLOAD_FAILED', 'package exceeds 100 MB');
      const digest = sha256(bytes);
      if (digest !== release.sha256) throw fail('DIGEST_MISMATCH', `expected ${release.sha256}, got ${digest}`);

      const staging = join(root, '.staging', randomUUID());
      mkdirSync(staging, { recursive: true });
      try {
        const archive = join(staging, 'package.tgz');
        const out = join(staging, 'app');
        writeFileSync(archive, bytes);
        mkdirSync(out);
        let total = 0;
        await tar.x({
          file: archive, cwd: out, strict: true, preservePaths: false, noChmod: true,
          // Regular files and folders only: no links, devices or absolute paths.
          filter: (_path, entry) => {
            total += /** @type {any} */ (entry).size ?? 0;
            const type = /** @type {any} */ (entry).type;
            return (type === 'File' || type === 'Directory') && total <= MAX_PACKAGE_BYTES;
          },
        });
        const { manifest } = checkAppDir(out, options.hostVersion);
        if (manifest.id !== entry.id || manifest.version !== release.version) {
          throw fail('MANIFEST_MISMATCH', `package is ${manifest.id}@${manifest.version}, catalog says ${entry.id}@${release.version}`);
        }
        const state = read();
        const before = state[entry.id];
        /** @type {Provenance} */
        const current = { id: entry.id, version: release.version, repository: entry.repository, url: release.url, sha256: digest, commit: release.commit, installedAt: new Date().toISOString() };
        const target = dirOf(current);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(join(root, entry.id), { recursive: true });
        renameSync(out, target);
        const previous = before && before.current.version !== release.version ? before.current : before?.previous ?? null;
        const keep = new Set([current.version, previous?.version]);
        for (const version of readdirSync(join(root, entry.id))) {
          if (!keep.has(version)) rmSync(join(root, entry.id, version), { recursive: true, force: true });
        }
        state[entry.id] = { current, previous };
        write(state);
        return current;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    },

    /** Swaps current and previous versions. @param {string} id */
    rollback(id) {
      const state = read();
      const s = state[id];
      if (!s?.previous) throw fail('NO_PREVIOUS_VERSION', `${id} has no previous version`);
      state[id] = { current: s.previous, previous: s.current };
      write(state);
      return state[id].current;
    },

    /** Removes every installed version of an app. @param {string} id */
    uninstall(id) {
      const state = read();
      if (!state[id]) throw fail('NOT_INSTALLED', `${id} is not installed`);
      delete state[id];
      write(state);
      rmSync(join(root, id), { recursive: true, force: true });
    },
  };
}
