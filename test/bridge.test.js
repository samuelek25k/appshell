import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServices } from '../packages/host/src/services.js';
import { createBridge } from '../packages/host/src/bridge.js';

/**
 * @param {any} t
 * @param {string} prefix
 */
function createTempWorkspace(t, prefix = 'appshell-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bridge supports shell.getLocale and reports system locale information', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-locale-');

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

test('storage persists key-value data per app and notifies listeners', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-storage-');
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

  const app = {
    manifest: {
      id: 'notes.app', version: '1.0.0', title: 'Notes', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
    },
    dir: '',
    protected: false,
  };

  const setRes = await bridge(app, 'storage.set', { key: 'theme', value: 'dark' });
  assert.equal(setRes.ok, true);
  assert.equal(changedKey, 'theme');
  assert.equal(changedVal, 'dark');

  const rawDisk = readFileSync(join(dir, 'apps', 'notes.app', 'storage.json'), 'utf8');
  assert.ok(rawDisk.includes('"theme":"dark"'));

  const getRes = await bridge(app, 'storage.get', { key: 'theme' });
  assert.equal(getRes.ok, true);
  if (getRes.ok) {
    assert.equal(getRes.result, 'dark');
  }
});
