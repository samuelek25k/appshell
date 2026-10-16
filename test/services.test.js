import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServices, appendWithRotation } from '../packages/host/src/services.js';

/**
 * @param {any} t
 * @param {string} prefix
 */
function createTempWorkspace(t, prefix = 'appshell-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('audit log records security and lifecycle events', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-audit-');
  const services = createServices(dir);
  services.audit({ event: 'APP_INSTALLED', actor: 'admin@corp.com', target: 'monitor', details: { version: '1.0.0' } });
  services.audit({ event: 'CAPABILITY_DENIED', target: 'rogue-app', details: { method: 'secrets.get', missing: 'secrets:key' } });

  const raw = readFileSync(join(dir, 'logs', 'audit.log'), 'utf8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'APP_INSTALLED');
  assert.equal(lines[0].actor, 'admin@corp.com');
  assert.equal(lines[1].event, 'CAPABILITY_DENIED');
  assert.equal(lines[1].details.missing, 'secrets:key');
  assert.ok(lines[0].t);
});

test('storage limits value size to 64 KB and store size to 1 MB', (t) => {
  const dir = createTempWorkspace(t, 'appshell-storage-limit-');
  const services = createServices(dir);

  const oversizedValue = 'x'.repeat(65 * 1024);
  assert.throws(() => services.storage.set('test-app', 'big', oversizedValue), { code: 'INVALID_PARAMS' });

  services.storage.set('test-app', 'valid', 'small value');
  assert.equal(services.storage.get('test-app', 'valid'), 'small value');

  services.removeAppData('test-app');
  assert.equal(existsSync(join(dir, 'apps', 'test-app')), false);
});

test('audit and app logs rotate at 2 MB and removeAppLogs unlinks both', (t) => {
  const dir = createTempWorkspace(t, 'appshell-log-rotate-');
  const services = createServices(dir);

  const logsDir = join(dir, 'logs');
  mkdirSync(logsDir, { recursive: true });
  writeFileSync(join(logsDir, 'audit.log'), 'x'.repeat(2 * 1024 * 1024));
  services.audit({ event: 'TEST_ROTATION' });

  assert.equal(existsSync(join(logsDir, 'audit.1.log')), true);
  assert.equal(existsSync(join(logsDir, 'audit.log')), true);
  const auditContent = readFileSync(join(logsDir, 'audit.log'), 'utf8');
  assert.ok(auditContent.includes('TEST_ROTATION'));

  writeFileSync(join(logsDir, 'test-app.log'), 'y'.repeat(2 * 1024 * 1024));
  services.log('test-app', 'info', 'rotated message');
  assert.equal(existsSync(join(logsDir, 'test-app.1.log')), true);
  assert.equal(existsSync(join(logsDir, 'test-app.log')), true);

  services.removeAppLogs('test-app');
  assert.equal(existsSync(join(logsDir, 'test-app.log')), false);
  assert.equal(existsSync(join(logsDir, 'test-app.1.log')), false);

  writeFileSync(join(logsDir, 'host.log'), 'z'.repeat(2 * 1024 * 1024));
  appendWithRotation(join(logsDir, 'host.log'), 'host rotated message\n');
  assert.equal(existsSync(join(logsDir, 'host.1.log')), true);
  assert.equal(existsSync(join(logsDir, 'host.log')), true);
});

