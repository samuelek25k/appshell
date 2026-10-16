import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, METHODS } from '../packages/contracts/index.js';
import { createServices } from '../packages/host/src/services.js';
import { createBridge } from '../packages/host/src/bridge.js';
import { createLauncherPreferences, homeLauncher } from '../packages/host/src/launcher.js';

const base = { version: '1.0.0', publisher: 'Test', engines: { appshell: '^0.1' }, entry: { ui: 'index.html' } };
const launcherManifest = /** @type {import('../packages/contracts/index.js').Manifest} */ ({ ...base, id: 'tiles', title: 'Tiles', kind: 'launcher', capabilities: { launcher: true } });
const plainManifest = { ...base, id: 'plain', title: 'Plain', capabilities: { launcher: true } };

/** @param {any} t */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-launcher-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a launcher manifest must declare the launcher capability', () => {
  assert.equal(validate('manifest', launcherManifest).ok, true);
  assert.equal(validate('manifest', { ...launcherManifest, capabilities: {} }).ok, false);
  assert.equal(validate('manifest', { ...base, id: 'x', title: 'X', kind: 'launcher' }).ok, false);
  assert.equal(validate('manifest', { ...base, id: 'x', title: 'X', kind: 'widget' }).ok, false);
});

test('only launcher apps with the capability may call launcher methods', () => {
  assert.equal(METHODS['launcher.apps'].requires(launcherManifest, {}), null);
  assert.equal(METHODS['launcher.apps'].requires(plainManifest, {}), 'launcher');
  assert.equal(METHODS['launcher.apps'].requires({ ...launcherManifest, capabilities: {} }, {}), 'launcher');
});

test('theme changes accept only known colour keys and hex values', () => {
  const ok = METHODS['launcher.setTheme'].params;
  assert.equal(ok({ source: 'dark' }), true);
  assert.equal(ok({ colors: { brand: '#aabbcc', ink: '#000000' } }), true);
  assert.equal(ok({}), false);
  assert.equal(ok({ source: 'neon' }), false);
  assert.equal(ok({ colors: { brand: 'red' } }), false);
  assert.equal(ok({ colors: { shadow: '#aabbcc' } }), false);
  assert.equal(ok({ colors: { brand: 'url(https://example.com)' } }), false);
});

test('the bridge serves launcher calls and denies apps without the capability', async (t) => {
  const calls = /** @type {string[]} */ ([]);
  const bridge = createBridge({
    policy: { blockedApps: ['blocked'] },
    services: createServices(workspace(t)),
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    launcher: {
      apps: () => [{ id: 'victim' }],
      widgets: () => [],
      open: (id) => { calls.push(`open:${id}`); return true; },
      setTheme: (theme) => { calls.push(`theme:${JSON.stringify(theme)}`); },
    },
  });
  const launcher = { manifest: launcherManifest, dir: '', protected: false };
  const plain = { manifest: plainManifest, dir: '', protected: false };

  assert.deepEqual(await bridge(launcher, 'launcher.apps', {}), { ok: true, result: [{ id: 'victim' }] });
  assert.deepEqual(await bridge(launcher, 'launcher.open', { id: 'victim' }), { ok: true, result: true });
  assert.equal((await bridge(launcher, 'launcher.open', { id: 'blocked' })).ok, false);
  assert.deepEqual(await bridge(launcher, 'launcher.setTheme', { colors: { brand: '#112233' } }), { ok: true, result: null });
  assert.deepEqual(calls, ['open:victim', 'theme:{"colors":{"brand":"#112233"}}']);

  const denied = await bridge(plain, 'launcher.apps', {});
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.error.code, 'CAPABILITY_DENIED');
});

test('launcher preferences persist per account root and drop invalid colours', (t) => {
  const first = workspace(t);
  const second = workspace(t);
  let current = first;
  const prefs = createLauncherPreferences(() => current);
  assert.deepEqual(prefs.get(), { launcher: null, colors: {} });
  prefs.setLauncher('tiles');
  prefs.setColors({ brand: '#112233', ink: 'nope', shadow: '#ffffff' });
  assert.deepEqual(prefs.get(), { launcher: 'tiles', colors: { brand: '#112233' } });
  current = second;
  assert.deepEqual(prefs.get(), { launcher: null, colors: {} });
  current = first;
  prefs.resetColors();
  assert.deepEqual(prefs.get(), { launcher: 'tiles', colors: {} });
});

test('home launcher is chosen only when it exists, is a launcher and is not blocked', () => {
  const apps = new Map(/** @type {any[]} */ ([['tiles', { manifest: launcherManifest }], ['plain', { manifest: plainManifest }]]));
  assert.equal(homeLauncher(apps, 'tiles'), 'tiles');
  assert.equal(homeLauncher(apps, 'tiles', ['tiles']), null);
  assert.equal(homeLauncher(apps, 'plain'), null);
  assert.equal(homeLauncher(apps, 'missing'), null);
  assert.equal(homeLauncher(apps, null), null);
});
