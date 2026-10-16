import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentity, verifyToken, TOKEN_TTL_SECONDS } from '../packages/host/src/identity.js';

test('tokens are scoped to one app, expire, and fail on tampering', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-id-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identity = createIdentity(dir, 'test-product');
  const jwk = identity.publicJwk();
  const { token } = identity.mint('ops.monitor', 1000);

  const claims = verifyToken(token, jwk, 'app:ops.monitor', 1001);
  assert.equal(claims.iss, 'test-product');
  assert.equal(claims.exp, 1000 + TOKEN_TTL_SECONDS);

  assert.throws(() => verifyToken(token, jwk, 'app:other', 1001), /token is for app:ops.monitor/);
  assert.throws(() => verifyToken(token, jwk, 'app:ops.monitor', 1000 + TOKEN_TTL_SECONDS), /expired/);
  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...claims, aud: 'app:other' })).toString('base64url');
  assert.throws(() => verifyToken(`${h}.${forged}.${s}`, jwk, 'app:other', 1001), /bad signature/);
  assert.throws(() => verifyToken(`${h}.${p}`, jwk, 'app:ops.monitor', 1001), /malformed/);
});

test('the signing key and subject persist; the key file is private', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-id-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = createIdentity(dir, 'p');
  const second = createIdentity(dir, 'p');
  assert.deepEqual(first.publicJwk(), second.publicJwk());
  const a = verifyToken(first.mint('x', 10).token, second.publicJwk(), 'app:x', 11);
  const b = verifyToken(second.mint('x', 10).token, first.publicJwk(), 'app:x', 11);
  assert.equal(a.sub, b.sub);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'signing-key.pem')).mode & 0o777, 0o600);
});

test('multi-account management supports switching, google/microsoft providers, and scoped minting', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-id-multi-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identity = createIdentity(dir, 'appshell');

  const initialAccounts = identity.listAccounts();
  assert.equal(initialAccounts.length, 1);
  assert.equal(initialAccounts[0].provider, 'local');
  assert.equal(initialAccounts[0].active, true);
  assert.equal(identity.getActiveAccount().id, initialAccounts[0].id);

  const googleAcc = identity.addAccount({
    name: 'Ada Lovelace',
    email: 'ada@google.internal',
    provider: 'google',
    role: 'Engineer',
  });
  assert.equal(googleAcc.provider, 'google');
  assert.equal(googleAcc.active, true);
  assert.equal(identity.getActiveAccount().id, googleAcc.id);
  assert.equal(identity.listAccounts().length, 2);

  const { token: googleToken } = identity.mint('notes.app', 2000);
  const googleClaims = verifyToken(googleToken, identity.publicJwk(), 'app:notes.app', 2001);
  assert.equal(googleClaims.sub, googleAcc.id);
  assert.equal(googleClaims.name, 'Ada Lovelace');
  assert.equal(googleClaims.email, 'ada@google.internal');
  assert.equal(googleClaims.provider, 'google');

  const msAcc = identity.addAccount({
    name: 'Alan Turing',
    email: 'alan@microsoft.com',
    provider: 'microsoft',
    role: 'Architect',
  });
  assert.equal(msAcc.provider, 'microsoft');
  assert.equal(identity.getActiveAccount().id, msAcc.id);

  identity.switchAccount(initialAccounts[0].id);
  assert.equal(identity.getActiveAccount().id, initialAccounts[0].id);

  identity.removeAccount(msAcc.id);
  assert.equal(identity.listAccounts().length, 2);
  assert.throws(() => identity.switchAccount(msAcc.id), /account not found/);

  identity.removeAccount(googleAcc.id);
  assert.equal(identity.listAccounts().length, 1);
  assert.throws(() => identity.removeAccount(initialAccounts[0].id), /cannot remove last account/);
});
