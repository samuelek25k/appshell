import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountRoot, evaluate, readJsonFile, waitForPage } from './cdp.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

/** @param {() => boolean} done */
const until = async (done) => { for (let i = 0; i < 80 && !done(); i++) await new Promise((r) => setTimeout(r, 250)); };

test('a launcher replaces the home screen, sets the theme within limits and falls back to the dashboard', { timeout: 120_000 }, async (t) => {
  const userData = mkdtempSync(join(tmpdir(), 'appshell-launcher-'));
  const port = 9800 + Math.floor(Math.random() * 400);
  const child = spawn(electron, [
    join(root, 'packages/host'), '--product', join(root, 'test/fixtures/product-launcher.json'), '--user-data', userData,
    `--remote-debugging-port=${port}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await waitForPage(port, 'file://', "typeof host === 'object' && document.readyState === 'complete'");
  const ui = (/** @type {string} */ js) => evaluate(port, 'file://', js);

  assert.equal(existsSync(join(accountRoot(userData), 'apps', 'tiles')), false, 'the dashboard is home until a launcher is chosen');
  assert.deepEqual(await ui("[...document.querySelectorAll('#launcher-select option')].map((o) => o.value)"), ['', 'tiles']);
  assert.equal(await ui("document.querySelectorAll('.app-btn[data-id=\"tiles\"]').length"), 0, 'launchers are not listed as apps');
  assert.equal(await ui("host.open('tiles')"), false, 'a launcher cannot be opened as an app');

  await ui("host.setLauncher('tiles')");
  const report = join(accountRoot(userData), 'apps', 'tiles', 'storage.json');
  await until(() => readJsonFile(report)?.report !== undefined);
  const stored = readJsonFile(report);
  assert.deepEqual(stored.report.apps, ['victim']);
  assert.match(stored.report.rejected, /INVALID_PARAMS/);
  assert.equal(stored.report.opened, false, 'a launcher cannot open itself');
  assert.equal(await ui("getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()"), '#112233');

  await evaluate(port, 'app://tiles', "document.getElementById('open').click()");
  let opened = false;
  for (let i = 0; i < 40 && !opened; i++) { await new Promise((r) => setTimeout(r, 250)); opened = await ui("document.body.classList.contains('app-open')"); }
  assert.equal(opened, true, 'the launcher opened an app');

  await ui('host.home()');
  await ui('host.setLauncher(null)');
  await assert.rejects(evaluate(port, 'app://tiles', '1'), /no page starts with/);
  assert.notEqual(await ui("getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()"), '#112233', 'launcher colours are dropped with the launcher');
});
