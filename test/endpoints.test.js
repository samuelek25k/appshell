import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { METHODS, networkAllowed, parseEndpoint, validate } from '../packages/contracts/index.js';
import { createServices } from '../packages/host/src/services.js';
import { createBridge } from '../packages/host/src/bridge.js';
import { createEndpoints, forgetApp } from '../packages/host/src/endpoints.js';

const manifest = /** @type {import('../packages/contracts/index.js').Manifest} */ ({
  id: 'reach', version: '1.0.0', title: 'Reach', publisher: 'Test', engines: { appshell: '^0.1' }, entry: { ui: 'index.html' },
  capabilities: { userEndpoints: true, network: ['api.example.com'] },
});

/** @param {any} t */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-endpoints-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('plain http is accepted only for this computer and private networks', () => {
  for (const url of ['http://localhost:11434', 'http://127.0.0.1:8080/x', 'http://192.168.1.20:11434', 'http://10.0.0.5', 'http://172.16.4.1:1', 'http://[::1]:3000', 'ws://localhost:9']) {
    assert.notEqual(parseEndpoint(url), null, url);
  }
  for (const url of ['http://example.com', 'http://172.32.0.1', 'http://8.8.8.8', 'http://192.168.1.999', 'ftp://localhost', 'http://user:pw@localhost', 'file:///etc/passwd', 'nonsense']) {
    assert.equal(parseEndpoint(url), null, url);
  }
  assert.equal(parseEndpoint('https://models.example.com:8443/v1/chat'), 'https://models.example.com:8443');
  assert.equal(parseEndpoint('http://localhost:11434/api/chat'), 'http://localhost:11434');
  assert.equal(parseEndpoint('ws://localhost:11434'), 'http://localhost:11434');
});

test('an approved address allows only its own scheme family, host and port', () => {
  const approved = ['http://localhost:11434'];
  assert.equal(networkAllowed(manifest, 'http://localhost:11434/api/tags', approved), true);
  assert.equal(networkAllowed(manifest, 'ws://localhost:11434/', approved), true);
  assert.equal(networkAllowed(manifest, 'http://localhost:11435/', approved), false);
  assert.equal(networkAllowed(manifest, 'https://localhost:11434/', approved), false);
  assert.equal(networkAllowed(manifest, 'http://localhost:11434/', []), false);
  assert.equal(networkAllowed(manifest, 'https://api.example.com/x', []), true);
});

test('only apps declaring userEndpoints may ask', () => {
  assert.equal(METHODS['network.requestEndpoint'].requires(manifest, {}), null);
  assert.equal(METHODS['network.requestEndpoint'].requires({ ...manifest, capabilities: {} }, {}), 'userEndpoints');
  assert.equal(validate('manifest', manifest).ok, true);
});

test('approved addresses persist per account root and are forgotten with the app', (t) => {
  const first = workspace(t);
  const second = workspace(t);
  let current = first;
  const store = createEndpoints(() => current);
  store.add('reach', 'http://localhost:11434');
  store.add('reach', 'http://localhost:11434');
  assert.deepEqual(store.list('reach'), ['http://localhost:11434']);
  current = second;
  assert.deepEqual(store.list('reach'), []);
  current = first;
  for (let i = 0; i < 7; i++) store.add('reach', `http://localhost:${2000 + i}`);
  assert.throws(() => store.add('reach', 'http://localhost:3000'), /at most 8/);
  forgetApp([first, second], 'reach');
  assert.deepEqual(store.list('reach'), []);
});

test('the bridge validates addresses, honours policy and reports the answer', async (t) => {
  const asked = /** @type {string[]} */ ([]);
  /** @param {boolean} [allowUserEndpoints] */
  const make = (allowUserEndpoints) => createBridge({
    policy: { allowUserEndpoints },
    services: createServices(workspace(t)),
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    endpoints: { request: async (_id, key) => { asked.push(key); return true; }, list: () => ['http://localhost:11434'] },
  });
  const app = { manifest, dir: '', protected: false };

  const bridge = make();
  assert.deepEqual(await bridge(app, 'network.requestEndpoint', { url: 'http://localhost:11434/api/chat' }), { ok: true, result: { approved: true, address: 'http://localhost:11434' } });
  assert.deepEqual(asked, ['http://localhost:11434']);
  const bad = await bridge(app, 'network.requestEndpoint', { url: 'http://example.com' });
  assert.equal(bad.ok === false && bad.error.code, 'INVALID_PARAMS');
  assert.deepEqual(await bridge(app, 'network.endpoints', {}), { ok: true, result: ['http://localhost:11434'] });

  const off = await make(false)(app, 'network.requestEndpoint', { url: 'http://localhost:11434' });
  assert.equal(off.ok === false && off.error.code, 'CAPABILITY_DENIED');
  const plain = await bridge({ ...app, manifest: { ...manifest, capabilities: {} } }, 'network.endpoints', {});
  assert.equal(plain.ok === false && plain.error.code, 'CAPABILITY_DENIED');
});
