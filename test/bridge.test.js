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

test('shell.supports reports only capabilities the host knows and the app holds', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-supports-');
  const bridge = createBridge({
    policy: {}, services: createServices(dir), locale: 'en-US', identity: /** @type {any} */ ({}), hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}), onTitle: () => {}, onWidget: () => {}, onCloseResponse: () => {},
  });
  const app = { manifest: { id: 'test-app', version: '1.0.0', title: 'Test', publisher: 'Test', engines: { appshell: '^1' }, entry: {}, capabilities: { notifications: true, network: [] } }, dir: '', protected: false };
  const ask = async (/** @type {string} */ name) => /** @type {any} */ (await bridge(app, 'shell.supports', { name })).result;
  assert.equal(await ask('notifications'), true);
  assert.equal(await ask('identity'), false);
  assert.equal(await ask('network'), false);
  assert.equal(await ask('hologram'), false);
  assert.equal((await bridge(app, 'shell.supports', {})).ok, false);
});

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

  let dynLocale = 'en-US';
  const dynBridge = createBridge({
    policy: {},
    services: createServices(dir),
    locale: () => dynLocale,
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
  });
  const dynRes1 = await dynBridge(app, 'shell.getLocale', {});
  assert.equal(/** @type {any} */ (dynRes1).result.locale, 'en-US');
  dynLocale = 'fa-IR';
  const dynRes2 = await dynBridge(app, 'shell.getLocale', {});
  assert.equal(/** @type {any} */ (dynRes2).result.locale, 'fa-IR');
  assert.equal(/** @type {any} */ (dynRes2).result.direction, 'rtl');
});

test('bridge supports shell.getTheme and reports active theme settings', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-theme-');

  const bridge = createBridge({
    policy: {},
    services: createServices(dir),
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    getTheme: () => ({ source: 'dark', dark: true }),
  });

  const app = { manifest: { id: 'test-app', version: '1.0.0', title: 'Test', publisher: 'Test', engines: { appshell: '^0.1' }, entry: {} }, dir: '', protected: false };
  const res = await bridge(app, 'shell.getTheme', {});
  assert.equal(res.ok, true);
  if (res.ok) {
    const data = /** @type {any} */ (res.result);
    assert.equal(data.source, 'dark');
    assert.equal(data.dark, true);
  }
});

test('bridge supports shell.getVersions and reports provenance for migrations', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-versions-');

  const bridge = createBridge({
    policy: {},
    services: createServices(dir),
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    getVersions: () => ({ current: '2.0.0', previous: '1.0.0', installedAt: '2026-10-16T10:00:00.000Z' }),
  });

  const app = { manifest: { id: 'test-app', version: '2.0.0', title: 'Test', publisher: 'Test', engines: { appshell: '^0.1' }, entry: {} }, dir: '', protected: false };
  const res = await bridge(app, 'shell.getVersions', {});
  assert.equal(res.ok, true);
  if (res.ok) {
    const data = /** @type {any} */ (res.result);
    assert.equal(data.current, '2.0.0');
    assert.equal(data.previous, '1.0.0');
    assert.equal(data.installedAt, '2026-10-16T10:00:00.000Z');
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
