import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccounts } from '../packages/host/src/accounts.js';

/** @param {(dir: string) => void | Promise<void>} fn */
const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'accounts-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('first start creates one local account named after the OS user', () => withDir((dir) => {
  const accounts = createAccounts(dir, 'Alex');
  assert.deepEqual(accounts.list().map((a) => [a.type, a.name, a.locked]), [['local', 'Alex', false]]);
  assert.match(accounts.claims().sub, /^local:/);
}));

test('existing app data moves into the first account', () => withDir((dir) => {
  mkdirSync(join(dir, 'apps', 'notes'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'notes', 'storage.json'), '{"a":1}');
  const accounts = createAccounts(dir, 'Alex');
  assert.equal(existsSync(join(dir, 'apps')), false);
  assert.equal(readFileSync(join(accounts.root(accounts.active()), 'apps', 'notes', 'storage.json'), 'utf8'), '{"a":1}');
  assert.equal(accounts.partition('notes'), 'persist:app:notes');
}));

test('accounts keep separate roots and partitions', () => withDir((dir) => {
  const accounts = createAccounts(dir, 'Alex');
  const first = accounts.active();
  const work = accounts.createLocal('Work');
  accounts.switchTo(work.id);
  assert.notEqual(accounts.root(accounts.active()), accounts.root(first));
  assert.notEqual(accounts.partition('notes'), `persist:app:${first.dir}:notes`);
  assert.equal(createAccounts(dir, 'Alex').active().id, work.id, 'active account survives restart');
}));

test('names and PINs are validated', () => withDir((dir) => {
  const accounts = createAccounts(dir, 'Alex');
  assert.throws(() => accounts.createLocal('  '), /name/);
  assert.throws(() => accounts.createLocal('x'.repeat(41)), /name/);
  assert.throws(() => accounts.createLocal('Work', '123'), /PIN/);
  assert.equal(accounts.createLocal('Work\u0000\u001b', '1234').name, 'Work');
}));

test('a PIN is hashed, required to switch, and locks out after repeated failures', () => withDir((dir) => {
  let clock = 1_000_000;
  const accounts = createAccounts(dir, 'Alex', () => clock);
  const locked = accounts.createLocal('Private', 'hunter22');
  assert.equal(locked.locked, true);
  assert.equal(readFileSync(join(dir, 'accounts.json'), 'utf8').includes('hunter22'), false);
  assert.throws(() => accounts.switchTo(locked.id), /wrong PIN/);
  assert.equal(accounts.switchTo(locked.id, 'hunter22').name, 'Private');
  accounts.switchTo(accounts.list()[0].id);
  for (let i = 0; i < 5; i++) assert.throws(() => accounts.switchTo(locked.id, 'nope'), /wrong PIN/);
  assert.throws(() => accounts.switchTo(locked.id, 'hunter22'), /too many attempts/);
  clock += 31_000;
  assert.equal(accounts.switchTo(locked.id, 'hunter22').id, locked.id);
}));

test('a guest has no name in its token and leaves nothing behind', () => withDir((dir) => {
  const accounts = createAccounts(dir, 'Alex');
  const guest = accounts.startGuest();
  const root = accounts.root(accounts.active());
  writeFileSync(join(root, 'marker'), 'x');
  assert.deepEqual(Object.keys(accounts.claims()).sort(), ['sub', 'type']);
  assert.match(accounts.claims().sub, /^guest:/);
  accounts.switchTo(accounts.list()[0].id);
  assert.equal(existsSync(root), false);
  assert.equal(accounts.list().some((a) => a.id === guest.id), false);
}));

test('leftover guest folders are swept on the next start', () => withDir((dir) => {
  createAccounts(dir, 'Alex');
  mkdirSync(join(dir, 'accounts', 'guest-left'), { recursive: true });
  createAccounts(dir, 'Alex');
  assert.equal(existsSync(join(dir, 'accounts', 'guest-left')), false);
}));

test('removing an account deletes its data, but the last one stays', () => withDir((dir) => {
  const accounts = createAccounts(dir, 'Alex');
  assert.throws(() => accounts.remove(accounts.list()[0].id), /last account/);
  const work = accounts.createLocal('Work');
  accounts.switchTo(work.id);
  const root = accounts.root(accounts.active());
  mkdirSync(root, { recursive: true });
  accounts.remove(work.id);
  assert.equal(existsSync(root), false);
  assert.equal(accounts.active().name, 'Alex');
}));
