// Phase 1: a catalog app installs from a verified package, runs isolated, and uninstalls
// with its data; a package whose digest does not match the catalog is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pack } from '../../packages/distribution/index.js';
import { evaluate, waitForPage } from './cdp.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

test('catalog apps install, run and uninstall; tampered packages are refused', { timeout: 120_000 }, async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'appshell-install-'));
  const userData = join(work, 'user');
  const victim = await pack(join(root, 'test/fixtures/apps/victim'), join(work, 'victim.tgz'), '0.1.0');
  const hostile = await pack(join(root, 'test/fixtures/apps/hostile'), join(work, 'hostile.tgz'), '0.1.0');
  const app = (/** @type {string} */ id, /** @type {string} */ file, /** @type {string} */ digest) => ({
    id, title: id, publisher: 'Test', repository: `https://github.com/example/${id}`,
    releases: [{ version: '1.0.0', channel: 'stable', url: pathToFileURL(join(work, file)).href, sha256: digest, commit: 'abc1234' }],
  });
  const catalogFile = join(work, 'index.json');
  writeFileSync(catalogFile, JSON.stringify({ format: 1, apps: [app('victim', 'victim.tgz', victim.sha256), app('hostile', 'hostile.tgz', 'f'.repeat(64))] }));

  const port = 9400 + Math.floor(Math.random() * 400);
  const child = spawn(electron, [
    join(root, 'packages/host'), '--product', join(root, 'test/fixtures/product-catalog.json'),
    '--catalog', pathToFileURL(catalogFile).href, '--user-data', userData, `--remote-debugging-port=${port}`,
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], { stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await waitForPage(port, 'file://');
  const ui = (/** @type {string} */ js) => evaluate(port, 'file://', js);
  await ui('host.refreshCatalog()');

  await ui("host.install('victim')");
  const installed = JSON.parse(readFileSync(join(userData, 'installed', 'installed.json'), 'utf8'));
  assert.equal(installed.victim.current.sha256, victim.sha256);
  assert.equal(installed.victim.current.commit, 'abc1234');

  await ui("host.open('victim')");
  const storage = join(userData, 'apps', 'victim', 'storage.json');
  for (let i = 0; i < 80 && !existsSync(storage); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(existsSync(storage), 'installed app ran and used its storage');

  await ui("host.install('hostile')");
  assert.match(await ui("document.getElementById('manager-error').textContent"), /expected f{64}/);
  assert.equal(existsSync(join(userData, 'installed', 'hostile')), false);

  await ui("host.uninstall('victim')");
  assert.equal(existsSync(join(userData, 'installed', 'victim')), false);
  assert.equal(existsSync(join(userData, 'apps', 'victim')), false, 'app data removed with the app');
});
