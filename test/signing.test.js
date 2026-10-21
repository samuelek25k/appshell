import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate } from '../packages/contracts/index.js';
import { createStore, generateSigningKey, pack, signPackage, verifySignature } from '../packages/distribution/index.js';

const HOST = '0.1.0';
const fixture = fileURLToPath(new URL('./fixtures/apps/victim', import.meta.url));
const policyFor = (/** @type {{ id: string, key: string }[] | undefined} */ trustedKeys) => ({ developerMode: true, allowedSources: ['https://github.com/example/'], trustedKeys });

/** @param {import('node:test').TestContext} t */
function workspace(t) {
  const work = mkdtempSync(join(tmpdir(), 'appshell-sign-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  return work;
}

/**
 * @param {string} work
 * @param {string | undefined} signature
 */
async function release(work, signature) {
  const dir = join(work, 'src');
  cpSync(fixture, dir, { recursive: true });
  const file = join(work, 'victim.tgz');
  const { sha256 } = await pack(dir, file, HOST);
  const entry = { id: 'victim', title: 'Victim', publisher: 'Test', repository: 'https://github.com/example/victim', releases: [] };
  return { file, entry, release: /** @type {import('../packages/distribution/index.js').Release} */ ({ version: '1.0.0', channel: 'stable', url: pathToFileURL(file).href, sha256, commit: 'abc1234', ...(signature ? { signature } : {}) }) };
}

test('a signature verifies only for the signed bytes and a listed key', () => {
  const owner = generateSigningKey();
  const other = generateSigningKey();
  const bytes = new TextEncoder().encode('package bytes');
  const signature = signPackage(bytes, owner.privateKey);
  assert.equal(verifySignature(bytes, signature, [{ id: 'shop', key: owner.publicKey }]), 'shop');
  assert.equal(verifySignature(bytes, signature, [{ id: 'other', key: other.publicKey }, { id: 'shop', key: owner.publicKey }]), 'shop');
  assert.equal(verifySignature(bytes, signature, [{ id: 'other', key: other.publicKey }]), null);
  assert.equal(verifySignature(new TextEncoder().encode('changed'), signature, [{ id: 'shop', key: owner.publicKey }]), null);
  assert.equal(verifySignature(bytes, 'AAAA', [{ id: 'shop', key: owner.publicKey }]), null);
  assert.equal(verifySignature(bytes, signature, [{ id: 'bad', key: 'not-a-key' }]), null);
});

test('with trusted keys an install needs a valid signature and records who signed', async (t) => {
  const work = workspace(t);
  const owner = generateSigningKey();
  const keys = [{ id: 'shop', key: owner.publicKey }];
  const unsigned = await release(work, undefined);
  const store = createStore(join(work, 'installed'));
  await assert.rejects(store.install(unsigned.entry, unsigned.release, { hostVersion: HOST, policy: policyFor(keys) }), { code: 'SIGNATURE_MISSING' });
  assert.equal(existsSync(join(work, 'installed', 'victim')), false);

  const stranger = signPackage(readFileSync(unsigned.file), generateSigningKey().privateKey);
  const wrong = await release(work, stranger);
  await assert.rejects(store.install(wrong.entry, wrong.release, { hostVersion: HOST, policy: policyFor(keys) }), { code: 'SIGNATURE_INVALID' });

  const signed = await release(work, signPackage(readFileSync(unsigned.file), owner.privateKey));
  const done = await store.install(signed.entry, signed.release, { hostVersion: HOST, policy: policyFor(keys) });
  assert.equal(done.signedBy, 'shop');
  assert.equal(store.list()[0].current.signedBy, 'shop');
});

test('without trusted keys unsigned installs behave as before', async (t) => {
  const work = workspace(t);
  const unsigned = await release(work, undefined);
  const store = createStore(join(work, 'installed'));
  const done = await store.install(unsigned.entry, unsigned.release, { hostVersion: HOST, policy: policyFor(undefined) });
  assert.equal(done.signedBy, undefined);
});

test('a signature is checked after the digest, so a swapped package fails on the digest first', async (t) => {
  const work = workspace(t);
  const owner = generateSigningKey();
  const base = await release(work, undefined);
  const signature = signPackage(readFileSync(base.file), owner.privateKey);
  writeFileSync(base.file, Buffer.concat([readFileSync(base.file), Buffer.from('x')]));
  const store = createStore(join(work, 'installed'));
  await assert.rejects(store.install(base.entry, { ...base.release, signature }, { hostVersion: HOST, policy: policyFor([{ id: 'shop', key: owner.publicKey }]) }), { code: 'DIGEST_MISMATCH' });
});

test('the schemas accept well-formed keys and signatures and refuse malformed ones', () => {
  const owner = generateSigningKey();
  const bytes = new TextEncoder().encode('x');
  const signature = signPackage(bytes, owner.privateKey);
  const product = (/** @type {unknown} */ trustedKeys) => ({ name: 'Shop', protocol: 'shop', dataDirectory: 'shop', package: { extension: '.shop', displayName: 'Shop' }, apps: [], policy: { trustedKeys } });
  assert.equal(validate('product', product([{ id: 'shop', key: owner.publicKey }])).ok, true);
  for (const bad of [[], [{ id: 'shop', key: 'short' }], [{ key: owner.publicKey }], [{ id: 'Bad Id', key: owner.publicKey }], [{ id: 'shop', key: owner.publicKey, extra: 1 }]]) {
    assert.equal(validate('product', product(bad)).ok, false, JSON.stringify(bad));
  }
  const catalog = (/** @type {unknown} */ sig) => ({ format: 1, apps: [{ id: 'victim', title: 'V', publisher: 'T', repository: 'https://github.com/example/victim', releases: [{ version: '1.0.0', channel: 'stable', url: 'https://github.com/example/victim/a.tgz', sha256: '0'.repeat(64), commit: 'abc1234', signature: sig }] }] });
  assert.equal(validate('catalog', catalog(signature)).ok, true);
  assert.equal(validate('catalog', catalog('nope')).ok, false);
});
