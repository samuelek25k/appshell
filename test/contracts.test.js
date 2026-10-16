import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, satisfiesEngine, networkAllowed, METHODS } from '../packages/contracts/index.js';

const manifest = {
  id: 'ops.monitor', version: '1.0.0', title: 'Monitor', publisher: 'Ops',
  engines: { appshell: '^0.1' }, entry: { ui: 'ui/index.html' },
  widgets: [{ id: 'delays', title: 'Delays' }],
  capabilities: { network: ['api.example.com'], secrets: ['api-key'] },
};

test('manifest schema accepts a valid manifest and rejects unknown fields', () => {
  assert.equal(validate('manifest', manifest).ok, true);
  assert.equal(validate('manifest', { ...manifest, nodeIntegration: true }).ok, false);
});

test('engine range follows caret rules, stricter for 0.x', () => {
  assert.equal(satisfiesEngine('^0.1', '0.1.5'), true);
  assert.equal(satisfiesEngine('^0.1', '0.2.0'), false);
  assert.equal(satisfiesEngine('^2.0', '2.3.1'), true);
  assert.equal(satisfiesEngine('^2.1', '2.0.9'), false);
});

test('network allows own origin and declared hosts only', () => {
  assert.equal(networkAllowed(manifest, 'app://ops.monitor/ui/index.html'), true);
  assert.equal(networkAllowed(manifest, 'app://other.app/'), false);
  assert.equal(networkAllowed(manifest, 'https://api.example.com/x'), true);
  assert.equal(networkAllowed(manifest, 'https://evil.example.com/x'), false);
  assert.equal(networkAllowed(manifest, 'http://api.example.com/x'), false);
});

test('capability checks name what is missing', () => {
  assert.equal(METHODS['secrets.get'].requires(manifest, { name: 'api-key' }), null);
  assert.equal(METHODS['secrets.get'].requires(manifest, { name: 'other' }), 'secrets:other');
  assert.equal(METHODS['notifications.show'].requires(manifest, {}), 'notifications');
  assert.equal(METHODS['widgets.update'].requires(manifest, { id: 'nope' }), 'widgets:nope');
  assert.equal(METHODS['identity.token'].requires(manifest, {}), 'identity');
  assert.equal(METHODS['identity.token'].requires({ ...manifest, capabilities: { identity: true } }, {}), null);
  assert.equal(METHODS['shell.listInstalledApps'].requires(manifest, {}), 'launcher');
  assert.equal(METHODS['shell.listInstalledApps'].requires({ ...manifest, capabilities: { launcher: true } }, {}), null);
  assert.equal(METHODS['shell.launchApp'].requires(manifest, { id: 'other' }), 'launcher');
  assert.equal(METHODS['shell.launchApp'].requires({ ...manifest, capabilities: { launcher: true } }, { id: 'other' }), null);
  assert.equal(METHODS['shell.getWidgets'].requires(manifest, {}), 'launcher');
  assert.equal(METHODS['shell.getWidgets'].requires({ ...manifest, capabilities: { launcher: true } }, {}), null);
});

test('product schema validates governance policies and allows omitted capabilities', () => {
  const baseProduct = {
    name: 'TestProduct',
    protocol: 'testapp',
    dataDirectory: 'testapp',
    package: { extension: '.testapp', displayName: 'Test App' },
    apps: [{ path: 'test' }],
    policy: {
      blockedApps: ['malicious-app'],
      requireReview: true,
      allowedSources: ['https://github.com/example/'],
      channel: 'stable',
    },
  };
  const res = validate('product', baseProduct);
  assert.equal(res.ok, true);
});

test('audit log records security and lifecycle events', async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServices } = await import('../packages/host/src/services.js');

  const dir = mkdtempSync(join(tmpdir(), 'appshell-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

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

test('bridge enforces blockedApps and audits denial on launch', async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServices } = await import('../packages/host/src/services.js');
  const { createBridge } = await import('../packages/host/src/bridge.js');

  const dir = mkdtempSync(join(tmpdir(), 'appshell-bridge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const services = createServices(dir);
  let launched = false;
  const bridge = createBridge({
    policy: { capabilities: 'enforce', blockedApps: ['banned-app'] },
    services,
    backendFor: () => (/** @type {any} */ ({})),
    identity: /** @type {any} */ ({ mint: () => ({ token: 'mock' }), publicJwk: () => ({}) }),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    hostLog: () => {},
    onLaunchApp: (id) => { launched = true; return true; },
  });

  const launcherApp = {
    manifest: {
      id: 'launcher', version: '1.0.0', title: 'Launcher', publisher: 'Appshell',
      engines: { appshell: '^0.1' }, entry: { ui: 'index.html' },
      capabilities: { launcher: true },
    },
    dir,
    protected: false,
  };

  // Launch allowed app
  const okRes = await bridge(launcherApp, 'shell.launchApp', { id: 'allowed-app' });
  assert.equal(okRes.ok, true);
  assert.equal(launched, true);

  // Launch blocked app
  const blockedRes = await bridge(launcherApp, 'shell.launchApp', { id: 'banned-app' });
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.error.code, 'CAPABILITY_DENIED');

  const auditLines = readFileSync(join(dir, 'logs', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const blockedAudit = auditLines.find((a) => a.event === 'APP_LAUNCH_BLOCKED');
  assert.ok(blockedAudit);
  assert.equal(blockedAudit.target, 'banned-app');
});

test('backend network preload blocks undeclared network connections', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { realpathSync } = await import('node:fs');

  const preload = realpathSync(fileURLToPath(new URL('../packages/host/preload/backend.cjs', import.meta.url)));
  const script = `
    const net = require('node:net');
    let netBlocked = false;
    let fetchBlocked = false;
    function checkDone() {
      if (netBlocked && fetchBlocked) {
        process.stdout.write('BLOCKED_ALL');
        process.exit(0);
      }
    }
    const s = net.connect({ host: 'evil.com', port: 80 });
    s.on('error', (e) => {
      if (e.message.includes('denied by Appshell capability policy')) netBlocked = true;
      checkDone();
    });
    fetch('https://evil.com')
      .then(() => process.exit(1))
      .catch((e) => {
        if (e.message.includes('denied by Appshell capability policy')) fetchBlocked = true;
        checkDone();
      });
  `;

  const child = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${preload}`,
    `--require=${preload}`,
    '-e', script,
  ], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: 'api.example.com' },
    encoding: 'utf8',
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'BLOCKED_ALL');
});

test('bridge supports shell.getLocale and reports system locale information', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServices } = await import('../packages/host/src/services.js');
  const { createBridge } = await import('../packages/host/src/bridge.js');

  const dir = mkdtempSync(join(tmpdir(), 'appshell-locale-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const bridge = createBridge({
    policy: {},
    services: createServices(dir),
    locale: 'ar-EG',
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
  });

  const app = { manifest: { id: 'test-app', version: '1.0.0', title: 'Test', publisher: 'Test', engines: { appshell: '^0.1' }, entry: {} }, dir: '', protected: false };
  const res = await bridge(app, 'shell.getLocale', {});
  assert.equal(res.ok, true);
  if (res.ok) {
    const data = /** @type {any} */ (res.result);
    assert.equal(data.locale, 'ar-EG');
    assert.equal(data.direction, 'rtl');
    assert.ok(Array.isArray(data.languages));
    assert.ok(typeof data.timeZone === 'string');
  }
});

test('secureStorage capability encrypts data at rest via authenticated AES-256-GCM', async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServices } = await import('../packages/host/src/services.js');
  const { createBridge } = await import('../packages/host/src/bridge.js');

  const dir = mkdtempSync(join(tmpdir(), 'appshell-secstore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const services = createServices(dir);
  let changedKey = '';
  let changedVal = null;

  const bridge = createBridge({
    policy: {},
    services,
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    onStorageChanged: (_appId, key, val) => {
      changedKey = key;
      changedVal = val;
    },
  });

  const secureApp = {
    manifest: {
      id: 'vault.app', version: '1.0.0', title: 'Vault', publisher: 'Security',
      engines: { appshell: '^0.1' }, entry: {},
      capabilities: { secureStorage: true },
    },
    dir: '',
    protected: false,
  };

  // Set confidential data
  const setRes = await bridge(secureApp, 'storage.set', { key: 'secret_token', value: { token: 'super-secret-xyz' } });
  assert.equal(setRes.ok, true);
  assert.equal(changedKey, 'secret_token');
  assert.deepEqual(changedVal, { token: 'super-secret-xyz' });

  // Verify file on disk is encrypted
  const rawDisk = readFileSync(join(dir, 'apps', 'vault.app', 'storage.json'), 'utf8');
  assert.ok(rawDisk.includes('__appshell_encrypted__'));
  assert.ok(!rawDisk.includes('super-secret-xyz'));

  // Verify transparent read through bridge returns decrypted data
  const getRes = await bridge(secureApp, 'storage.get', { key: 'secret_token' });
  assert.equal(getRes.ok, true);
  if (getRes.ok) {
    assert.deepEqual(getRes.result, { token: 'super-secret-xyz' });
  }
});


