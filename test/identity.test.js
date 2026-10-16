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
  const { token } = identity.mint('ops.monitor', undefined, 1000);

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
  const a = verifyToken(first.mint('x', undefined, 10).token, second.publicJwk(), 'app:x', 11);
  const b = verifyToken(second.mint('x', undefined, 10).token, first.publicJwk(), 'app:x', 11);
  assert.equal(a.sub, b.sub);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'signing-key.pem')).mode & 0o777, 0o600);
});


test('a signed-in account adds its id, type and name to the token; a guest adds no name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  const identity = createIdentity(dir, 'p');
  const local = verifyToken(identity.mint('x', { sub: 'local:1', type: 'local', name: 'Alex' }, 10).token, identity.publicJwk(), 'app:x', 11);
  assert.deepEqual([local.sub, local.type, local.name, local.email], ['local:1', 'local', 'Alex', undefined]);
  const guest = verifyToken(identity.mint('x', { sub: 'guest:2', type: 'guest' }, 10).token, identity.publicJwk(), 'app:x', 11);
  assert.deepEqual([guest.sub, guest.type, 'name' in guest], ['guest:2', 'guest', false]);
});
