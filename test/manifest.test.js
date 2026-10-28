import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, satisfiesEngine, effectiveCapabilities, METHODS } from '../packages/contracts/index.js';

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

test('engine range is a caret on the major version, with ^0.1 kept for the first released apps', () => {
  assert.equal(satisfiesEngine('^1', '1.4.2'), true);
  assert.equal(satisfiesEngine('^1', '2.0.0'), false);
  assert.equal(satisfiesEngine('^1.2', '1.3.0'), true);
  assert.equal(satisfiesEngine('^1.2', '1.1.9'), false);
  assert.equal(satisfiesEngine('^0.1', '0.1.5'), true);
  assert.equal(satisfiesEngine('^0.1', '1.0.0'), true);
  assert.equal(satisfiesEngine('^0.1', '2.0.0'), false);
  assert.equal(satisfiesEngine('^0.2', '1.0.0'), false);
  assert.equal(satisfiesEngine('^1.x', '1.0.0'), false);
});

test('optional capabilities are merged when the host knows them and ignored when it does not', () => {
  const base = { id: 'a', version: '1.0.0', title: 'A', publisher: 'P', engines: { appshell: '^1' }, entry: { ui: 'index.html' } };
  const manifest = { ...base, capabilities: { identity: true }, optionalCapabilities: { notifications: true, hologram: { depth: 3 } } };
  assert.equal(validate('manifest', manifest).ok, true);
  assert.deepEqual(effectiveCapabilities(manifest), { notifications: true, identity: true });
  assert.deepEqual(effectiveCapabilities({ ...manifest, optionalCapabilities: { identity: false } }), { identity: true });
  assert.equal(validate('manifest', { ...base, optionalCapabilities: 'notifications' }).ok, false);
  assert.equal(validate('manifest', { ...base, capabilities: { hologram: true } }).ok, false, 'a required capability the host does not know still fails');
  assert.equal(validate('manifest', { ...base, capabilities: effectiveCapabilities({ ...base, optionalCapabilities: { notifications: 'yes' } }) }).ok, false, 'a known optional capability keeps its schema');
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
