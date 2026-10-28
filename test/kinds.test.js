import test from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, isHome, isOpenable, kindOf } from '../packages/host/src/kinds.js';

const manifest = (kind) => ({ id: 'a', version: '1.0.0', title: 'A', publisher: 'P', engines: { appshell: '^0.1' }, entry: { ui: 'index.html' }, ...(kind ? { kind } : {}) });

test('an app without a kind is an openable app', () => {
  assert.equal(kindOf(manifest()), 'app');
  assert.equal(isOpenable(manifest()), true);
  assert.equal(isHome(manifest()), false);
});

test('a launcher fills the home area and is never opened as an app', () => {
  assert.equal(isOpenable(manifest('launcher')), false);
  assert.equal(isHome(manifest('launcher')), true);
});

test('every kind the manifest schema allows is in the table', async () => {
  const { default: schema } = await import('../packages/contracts/schemas/manifest.schema.json', { with: { type: 'json' } });
  assert.deepEqual([...schema.properties.kind.enum].sort(), Object.keys(KINDS).sort());
});
