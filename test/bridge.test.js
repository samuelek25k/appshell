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

test('bridge enforces browser capability and mediates browser methods', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-browser-');
  const services = createServices(dir);
  /** @type {string[]} */
  const calls = [];

  const mockBrowser = {
    navigate: async (/** @type {string} */ id, /** @type {any} */ _m, /** @type {string} */ url) => {
      calls.push(`navigate:${id}:${url}`);
      return { url, title: 'Mock Page' };
    },
    act: async (/** @type {string} */ id, /** @type {any} */ p) => {
      calls.push(`act:${id}:${p.action}:${p.selector}`);
      return { action: p.action, selector: p.selector, success: true };
    },
    extract: async (/** @type {string} */ id, /** @type {any} */ p) => {
      calls.push(`extract:${id}:${p.selector}`);
      return { value: 'extracted text' };
    },
    evaluate: async (/** @type {string} */ id, /** @type {any} */ p) => {
      calls.push(`evaluate:${id}:${p.script}`);
      return { result: 42 };
    },
    screenshot: async (/** @type {string} */ id) => {
      calls.push(`screenshot:${id}`);
      return { dataUrl: 'data:image/png;base64,mock' };
    },
    status: async (/** @type {string} */ id) => {
      calls.push(`status:${id}`);
      return { active: true, url: 'https://example.com', title: 'Mock', loading: false };
    },
    close: async (/** @type {string} */ id) => {
      calls.push(`close:${id}`);
      return { closed: true };
    },
  };

  const bridge = createBridge({
    policy: { capabilities: 'enforce' },
    services,
    browser: /** @type {any} */ (mockBrowser),
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
  });

  const unprivilegedApp = {
    manifest: {
      id: 'basic.app', version: '1.0.0', title: 'Basic', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
    },
    dir: '',
    protected: false,
  };

  const privilegedApp = {
    manifest: {
      id: 'agent.app', version: '1.0.0', title: 'Agent', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
      capabilities: { browser: { allowedDomains: ['example.com'] } },
    },
    dir: '',
    protected: false,
  };

  const deniedNav = await bridge(unprivilegedApp, 'browser.navigate', { url: 'https://example.com' });
  assert.equal(deniedNav.ok, false);
  if (!deniedNav.ok) {
    assert.equal(deniedNav.error.code, 'CAPABILITY_DENIED');
  }

  const deniedDomain = await bridge(privilegedApp, 'browser.navigate', { url: 'https://other.com' });
  assert.equal(deniedDomain.ok, false);
  if (!deniedDomain.ok) {
    assert.equal(deniedDomain.error.code, 'CAPABILITY_DENIED');
  }

  const allowedNav = await bridge(privilegedApp, 'browser.navigate', { url: 'https://example.com/login' });
  assert.equal(allowedNav.ok, true);
  if (allowedNav.ok) {
    assert.equal(/** @type {any} */ (allowedNav.result).title, 'Mock Page');
  }

  const actRes = await bridge(privilegedApp, 'browser.act', { action: 'click', selector: '#btn' });
  assert.equal(actRes.ok, true);

  const extRes = await bridge(privilegedApp, 'browser.extract', { selector: 'h1', format: 'text' });
  assert.equal(extRes.ok, true);

  const evalRes = await bridge(privilegedApp, 'browser.evaluate', { script: '1 + 1' });
  assert.equal(evalRes.ok, true);

  const shotRes = await bridge(privilegedApp, 'browser.screenshot', {});
  assert.equal(shotRes.ok, true);

  const statRes = await bridge(privilegedApp, 'browser.status', {});
  assert.equal(statRes.ok, true);

  const closeRes = await bridge(privilegedApp, 'browser.close', {});
  assert.equal(closeRes.ok, true);

  assert.deepEqual(calls, [
    'navigate:agent.app:https://example.com/login',
    'act:agent.app:click:#btn',
    'extract:agent.app:h1',
    'evaluate:agent.app:1 + 1',
    'screenshot:agent.app',
    'status:agent.app',
    'close:agent.app',
  ]);
});

