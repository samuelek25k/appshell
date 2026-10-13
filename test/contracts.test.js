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
});
