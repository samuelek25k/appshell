import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LIMITS, LIMIT_CEILINGS, limitsFor, validate } from '../packages/contracts/index.js';
import { createServices } from '../packages/host/src/services.js';

const asGrants = (/** @type {unknown} */ g) => /** @type {import('../packages/contracts/index.js').Grant[]} */ (g);
const product = (/** @type {unknown[]} */ grants) => ({
  name: 'Shop', protocol: 'shop', dataDirectory: 'shop', package: { extension: '.shop', displayName: 'Shop' }, apps: [], policy: { grants },
});

test('without grants every app keeps the default limits', () => {
  for (const source of /** @type {const} */ (['bundled', 'catalog'])) {
    assert.deepEqual(limitsFor(undefined, { id: 'till', source }), { ...DEFAULT_LIMITS, granted: false });
    assert.deepEqual(limitsFor([], { id: 'till', source }), { ...DEFAULT_LIMITS, granted: false });
  }
});

test('an app with no known source never matches a grant', () => {
  assert.deepEqual(limitsFor(asGrants([{ from: ['bundled', 'catalog'], storageMb: 16 }]), { id: 'till' }), { ...DEFAULT_LIMITS, granted: false });
});

test('a grant applies to the sources it names and to nothing else', () => {
  const grants = [{ from: ['catalog'], storageMb: 16, backendIdleMinutes: 480 }];
  assert.deepEqual(limitsFor(asGrants(grants), { id: 'till', source: 'catalog' }), { storageBytes: 16 * 1024 * 1024, backendIdleMs: 480 * 60_000, granted: true });
  assert.deepEqual(limitsFor(asGrants(grants), { id: 'till', source: 'bundled' }), { ...DEFAULT_LIMITS, granted: false });
});

test('a grant that names apps applies to those apps only', () => {
  const grants = [{ from: ['catalog'], apps: ['till'], storageMb: 8 }];
  assert.equal(limitsFor(asGrants(grants), { id: 'till', source: 'catalog' }).storageBytes, 8 * 1024 * 1024);
  assert.equal(limitsFor(asGrants(grants), { id: 'notes', source: 'catalog' }).storageBytes, DEFAULT_LIMITS.storageBytes);
});

test('grants only widen: the largest matching value wins and a grant never lowers a limit', () => {
  const grants = [{ from: ['catalog'], storageMb: 16 }, { from: ['catalog'], apps: ['till'], storageMb: 4, backendIdleMinutes: 5 }];
  const limits = limitsFor(asGrants(grants), { id: 'till', source: 'catalog' });
  assert.equal(limits.storageBytes, 16 * 1024 * 1024);
  assert.equal(limits.backendIdleMs, 5 * 60_000);
  assert.equal(limitsFor(asGrants([{ from: ['catalog'], backendIdleMinutes: 0.5 }]), { id: 'till', source: 'catalog' }).backendIdleMs, DEFAULT_LIMITS.backendIdleMs);
});

test('values above the platform ceilings are clamped at run time', () => {
  const limits = limitsFor(asGrants([{ from: ['catalog'], storageMb: 9999, backendIdleMinutes: 99999 }]), { id: 'till', source: 'catalog' });
  assert.equal(limits.storageBytes, LIMIT_CEILINGS.storageMb * 1024 * 1024);
  assert.equal(limits.backendIdleMs, LIMIT_CEILINGS.backendIdleMinutes * 60_000);
});

test('the product schema accepts grants within the ceilings', () => {
  assert.equal(validate('product', product([{ from: ['bundled', 'catalog'], apps: ['till'], storageMb: 16, backendIdleMinutes: 480 }])).ok, true);
});

test('the product schema refuses wildcards, unknown sources, empty or oversized grants and unknown keys', () => {
  const bad = [
    { from: ['any'], storageMb: 2 },
    { from: ['*'], storageMb: 2 },
    { from: [], storageMb: 2 },
    { storageMb: 2 },
    { from: ['catalog'], apps: ['*'], storageMb: 2 },
    { from: ['catalog'], storageMb: LIMIT_CEILINGS.storageMb + 1 },
    { from: ['catalog'], backendIdleMinutes: LIMIT_CEILINGS.backendIdleMinutes + 1 },
    { from: ['catalog'], storageMb: 0 },
    { from: ['catalog'], network: 'any' },
  ];
  for (const grant of bad) assert.equal(validate('product', product([grant])).ok, false, JSON.stringify(grant));
});

test('storage honours the per-app limit the host supplies', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-grants-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chunk = 'x'.repeat(60 * 1024);
  const fill = (/** @type {ReturnType<typeof createServices>} */ services, /** @type {number} */ parts) => {
    for (let i = 0; i < parts; i++) services.storage.set('till', `k${i}`, chunk);
  };
  const plain = createServices(dir);
  assert.throws(() => fill(plain, 20), { code: 'INVALID_PARAMS' });
  const roomy = createServices(dir, dir, () => ({ storageBytes: 4 * 1024 * 1024 }));
  fill(roomy, 20);
  assert.equal(roomy.storage.get('till', 'k19'), chunk);
  assert.throws(() => fill(roomy, 80), { code: 'INVALID_PARAMS' });
});
