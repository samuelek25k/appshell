import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountRoot, evaluate, waitForPage } from './cdp.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

test('a new app from the template runs with its sandboxed backend', { timeout: 90_000 }, async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'appshell-template-'));
  const app = join(work, 'hello');
  execFileSync(process.execPath, [join(root, 'packages/cli/bin.js'), 'create', app, '--id', 'hello', '--title', 'Hello']);
  writeFileSync(join(work, 'product.json'), JSON.stringify({
    name: 'Template Test', protocol: 'appshelltemplate', dataDirectory: 'appshell-template-test',
    package: { extension: '.tgz', displayName: 'App' }, apps: [{ path: app }],
    policy: { capabilities: 'enforce', developerMode: true },
  }));
  const port = 9800 + Math.floor(Math.random() * 100);
  let childStderr = '';
  const child = spawn(electron, [
    join(root, 'packages/host'), '--product', join(work, 'product.json'), '--user-data', join(work, 'data'),
    `--remote-debugging-port=${port}`, 'appshelltemplate://hello/', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr?.on('data', (d) => { childStderr += d; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await waitForPage(port, 'app://hello');
  let greeting = '';
  let evalError = '';
  for (let i = 0; i < 40 && !greeting.startsWith('Hello from the backend'); i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      greeting = (await evaluate(port, 'app://hello', "document.getElementById('greeting')?.textContent")) ?? '';
    } catch (e) {
      evalError = String(e);
    }
  }
  let pageHtml = '';
  try { pageHtml = await evaluate(port, 'app://hello', 'document.body.innerHTML'); } catch {}
  const readLog = (/** @type {string} */ name) => { try { return readFileSync(join(name === 'host.log' ? join(work, 'data') : accountRoot(join(work, 'data')), 'logs', name), 'utf8'); } catch { return '<none>'; } };
  assert.notEqual((await evaluate(port, 'app://hello', "getComputedStyle(document.documentElement).getPropertyValue('--ui-accent')")).trim(), '', 'the UI kit loads from the host');
  assert.equal(greeting, 'Hello from the backend. Visit 1.', `Greeting mismatch.\nPage HTML: ${pageHtml}\nEval error: ${evalError}\nHost log:\n${readLog('host.log')}\nHello log:\n${readLog('hello.log')}\nChild stderr:\n${childStderr}`);
});
