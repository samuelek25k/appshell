import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tar from 'tar';
import { createStore, latestRelease, pack, sha256, sourceAllowed, compareVersions, parseCatalog } from '../packages/distribution/index.js';

const HOST = '0.1.0';
const fixture = fileURLToPath(new URL('./fixtures/apps/victim', import.meta.url));
const devPolicy = { developerMode: true, allowedSources: ['https://github.com/example/'] };

/** @typedef {import('../packages/distribution/index.js').Release} Release */

/**
 * @param {string} work
 * @param {string} version
 * @returns {Promise<Release>}
 */
async function release(work, version) {
  const dir = join(work, `src-${version}`);
  cpSync(fixture, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, version }));
  const file = join(work, `victim-${version}.tgz`);
  const { sha256: digest } = await pack(dir, file, HOST);
  return { version, channel: 'stable', url: pathToFileURL(file).href, sha256: digest, commit: 'abc1234' };
}

const entry = (/** @type {Release[]} */ releases) => ({ id: 'victim', title: 'Victim', publisher: 'Test', repository: 'https://github.com/example/victim', releases });

/** @param {import('node:test').TestContext} t */
function workspace(t) {
  const work = mkdtempSync(join(tmpdir(), 'appshell-dist-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  return work;
}

test('versions sort by semver with prereleases first', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('2.0.0-beta.1', '2.0.0') < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  const e = entry([
    { version: '1.0.0', channel: 'stable' }, { version: '1.2.0-beta.1', channel: 'beta' }, { version: '1.1.0', channel: 'stable' },
  ].map((r) => /** @type {Release} */ ({ ...r, url: 'file:///x', sha256: '0'.repeat(64), commit: 'abc1234' })));
  assert.equal(latestRelease(e, 'stable')?.version, '1.1.0');
  assert.equal(latestRelease(e, 'beta')?.version, '1.2.0-beta.1');
});

test('sources must match the allowlist; file:// only in developer mode', () => {
  const policy = { allowedSources: ['https://github.com/acme/'] };
  assert.equal(sourceAllowed('https://github.com/acme/app/releases/x.tgz', policy), true);
  assert.equal(sourceAllowed('https://github.com/acmeevil/app', policy), false);
  assert.equal(sourceAllowed('http://github.com/acme/app', policy), false);
  assert.equal(sourceAllowed('file:///tmp/x.tgz', policy), false);
  assert.equal(sourceAllowed('file:///tmp/x.tgz', devPolicy), true);
});

test('catalog documents are validated', () => {
  assert.throws(() => parseCatalog(JSON.stringify({ format: 1, apps: [{ id: 'x' }] })), /INVALID|must have/);
  assert.deepEqual(parseCatalog(JSON.stringify({ format: 1, apps: [] })), []);
});

test('install, update, rollback and uninstall keep provenance and at most two versions', async (t) => {
  const work = workspace(t);
  const store = createStore(join(work, 'installed'));
  const v1 = await release(work, '1.0.0');
  const v2 = await release(work, '1.1.0');
  const v3 = await release(work, '1.2.0');

  const first = await store.install(entry([v1]), v1, { hostVersion: HOST, policy: devPolicy });
  assert.deepEqual([first.id, first.version, first.sha256, first.commit], ['victim', '1.0.0', v1.sha256, 'abc1234']);
  assert.ok(existsSync(join(work, 'installed', 'victim', '1.0.0', 'manifest.json')));

  await store.install(entry([v1, v2]), v2, { hostVersion: HOST, policy: devPolicy });
  await store.install(entry([v1, v2, v3]), v3, { hostVersion: HOST, policy: devPolicy });
  const [state] = store.list();
  assert.equal(state.current.version, '1.2.0');
  assert.equal(state.previous?.version, '1.1.0');
  assert.equal(existsSync(join(work, 'installed', 'victim', '1.0.0')), false, 'oldest version is removed');

  assert.equal(store.rollback('victim').version, '1.1.0');
  assert.equal(store.list()[0].previous?.version, '1.2.0');

  store.uninstall('victim');
  assert.deepEqual(store.list(), []);
  assert.equal(existsSync(join(work, 'installed', 'victim')), false);
});

test('a package whose digest does not match the catalog is rejected', async (t) => {
  const work = workspace(t);
  const store = createStore(join(work, 'installed'));
  const v1 = await release(work, '1.0.0');
  /** @type {Release} */
  const tampered = { ...v1, sha256: sha256(new Uint8Array([1])) };
  await assert.rejects(store.install(entry([tampered]), tampered, { hostVersion: HOST, policy: devPolicy }), { code: 'DIGEST_MISMATCH' });
  assert.deepEqual(store.list(), []);
});

test('a package claiming another id or version is rejected', async (t) => {
  const work = workspace(t);
  const store = createStore(join(work, 'installed'));
  const v1 = await release(work, '1.0.0');
  /** @type {Release} */
  const lying = { ...v1, version: '9.9.9' };
  await assert.rejects(store.install(entry([lying]), lying, { hostVersion: HOST, policy: devPolicy }), { code: 'MANIFEST_MISMATCH' });
  const other = { ...entry([v1]), id: 'someone-else' };
  await assert.rejects(store.install(other, v1, { hostVersion: HOST, policy: devPolicy }), { code: 'MANIFEST_MISMATCH' });
});

test('sources outside the allowlist are refused before download', async (t) => {
  const work = workspace(t);
  const store = createStore(join(work, 'installed'));
  const v1 = await release(work, '1.0.0');
  await assert.rejects(store.install(entry([v1]), v1, { hostVersion: HOST, policy: { allowedSources: ['https://github.com/example/'] } }), { code: 'SOURCE_NOT_ALLOWED' }, 'file:// needs developer mode');
});

test('symlinks in a package are not extracted', { skip: process.platform === 'win32' }, async (t) => {
  const work = workspace(t);
  const src = join(work, 'src');
  cpSync(fixture, src, { recursive: true });
  symlinkSync('/etc/hosts', join(src, 'hosts-link'));
  mkdirSync(join(work, 'out'));
  const file = join(work, 'evil.tgz');
  await tar.c({ gzip: true, file, cwd: src, portable: true }, ['.']);
  /** @type {Release} */
  const evil = { version: '1.0.0', channel: 'stable', url: pathToFileURL(file).href, sha256: sha256(readFileSync(file)), commit: 'abc1234' };
  const store = createStore(join(work, 'installed'));
  await store.install(entry([evil]), evil, { hostVersion: HOST, policy: devPolicy });
  assert.equal(existsSync(join(work, 'installed', 'victim', '1.0.0', 'hosts-link')), false);
});

test('store prunes staging directories, unlisted apps, and obsolete versions', async (t) => {
  const work = workspace(t);
  const installedDir = join(work, 'installed');
  const store = createStore(installedDir);
  const v1 = await release(work, '1.0.0');
  const v2 = await release(work, '1.1.0');
  await store.install(entry([v1, v2]), v1, { hostVersion: HOST, policy: devPolicy });
  await store.install(entry([v1, v2]), v2, { hostVersion: HOST, policy: devPolicy });

  mkdirSync(join(installedDir, '.staging', 'orphan-stage'), { recursive: true });
  writeFileSync(join(installedDir, '.staging', 'orphan-stage', 'junk.txt'), 'stale');
  mkdirSync(join(installedDir, 'unlisted-app', '1.0.0'), { recursive: true });
  mkdirSync(join(installedDir, 'victim', '0.0.1'), { recursive: true });

  assert.equal(existsSync(join(installedDir, '.staging', 'orphan-stage')), true);
  assert.equal(existsSync(join(installedDir, 'unlisted-app')), true);
  assert.equal(existsSync(join(installedDir, 'victim', '0.0.1')), true);

  store.prune();

  assert.equal(existsSync(join(installedDir, '.staging')), false);
  assert.equal(existsSync(join(installedDir, 'unlisted-app')), false);
  assert.equal(existsSync(join(installedDir, 'victim', '0.0.1')), false);
  assert.equal(existsSync(join(installedDir, 'victim', '1.0.0')), true);
  assert.equal(existsSync(join(installedDir, 'victim', '1.1.0')), true);
});
