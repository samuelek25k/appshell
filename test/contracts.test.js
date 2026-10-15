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

