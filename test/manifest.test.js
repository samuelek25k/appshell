import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, satisfiesEngine, METHODS } from '../packages/contracts/index.js';

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

test('capability checks name what is missing', () => {
  assert.equal(METHODS['secrets.get'].requires(manifest, { name: 'api-key' }), null);
  assert.equal(METHODS['secrets.get'].requires(manifest, { name: 'other' }), 'secrets:other');
  assert.equal(METHODS['notifications.show'].requires(manifest, {}), 'notifications');
  assert.equal(METHODS['widgets.update'].requires(manifest, { id: 'nope' }), 'widgets:nope');
  assert.equal(METHODS['identity.token'].requires(manifest, {}), 'identity');
  assert.equal(METHODS['identity.token'].requires({ ...manifest, capabilities: { identity: true } }, {}), null);
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
      allowedSources: ['https://github.com/example/'],
      channel: 'stable',
    },
  };
  const res = validate('product', baseProduct);
  assert.equal(res.ok, true);
  assert.equal(validate('product', { ...baseProduct, defaultLocale: 'fr-FR' }).ok, true);
  assert.equal(validate('product', { ...baseProduct, defaultLocale: 'invalid_locale' }).ok, false);
});

test('apps target the engine version, not the product version', () => {
  const host = JSON.parse(readFileSync(new URL('../packages/host/package.json', import.meta.url), 'utf8'));
  const template = JSON.parse(readFileSync(new URL('../packages/cli/template/manifest.json', import.meta.url), 'utf8'));
  assert.match(host.appshell?.engine ?? '', /^\d+\.\d+\.\d+$/);
  assert.equal(satisfiesEngine(template.engines.appshell, host.appshell.engine), true);
});
