import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, waitForPage } from './cdp.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

test('kiosk mode needs a PIN account, locks management and ends only with the PIN', { timeout: 120_000 }, async (t) => {
  const userData = mkdtempSync(join(tmpdir(), 'appshell-kiosk-'));
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
  const state = () => ui('new Promise((resolve) => host.onState(resolve))');
  const wait = () => new Promise((resolve) => setTimeout(resolve, 400));

  await ui('host.setKiosk(true)');
  await wait();
  assert.equal((await state()).kiosk, false, 'an account without a PIN cannot start kiosk mode');

  await ui("host.addAccount('Desk', '4321')");
  await wait();
  const desk = (await state()).accounts.list.find((/** @type {any} */ a) => a.name === 'Desk').id;
  await ui(`host.switchAccount('${desk}', '4321')`);
  await wait();
  await ui('host.setKiosk(true)');
  await wait();
  const started = await state();
  assert.equal(started.kiosk, true);
  assert.equal(await ui('document.body.dataset.kiosk'), 'true');

  await ui("host.setLauncher('tiles')");
  await ui('host.startGuest()');
  await ui("host.addAccount('Other')");
  await wait();
  const locked = await state();
  assert.equal(locked.launcher.active, null, 'the home screen cannot change in kiosk mode');
  assert.equal(locked.accounts.list.length, started.accounts.list.length, 'accounts cannot be added or started in kiosk mode');
  assert.equal(locked.accounts.activeId, desk);

  await ui("host.setKiosk(false, '0000')");
  await wait();
  const refused = await state();
  assert.equal(refused.kiosk, true, 'a wrong PIN does not end kiosk mode');
  assert.equal(refused.accounts.error, 'wrong PIN');

  await ui("host.setKiosk(false, '4321')");
  await wait();
  assert.equal((await state()).kiosk, false);
  assert.equal(await ui('document.body.dataset.kiosk'), 'false');
});
