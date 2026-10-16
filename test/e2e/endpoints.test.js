import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountRoot, evaluate, waitForPage } from './cdp.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

/** @param {() => boolean} done */
const until = async (done) => { for (let i = 0; i < 80 && !done(); i++) await new Promise((r) => setTimeout(r, 250)); };

/** @param {string} body */
async function listen(body) {
  const server = createServer((_req, res) => { res.writeHead(200, { 'access-control-allow-origin': '*' }); res.end(body); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/` };
}

test('an approved address works for that app only and stops working when removed', { timeout: 120_000 }, async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'appshell-endpoints-'));
  const userData = join(work, 'user');
  const allowed = await listen('allowed-address');
  const sibling = await listen('sibling-address');
  mkdirSync(join(work, 'apps'));
  cpSync(join(root, 'test/fixtures/apps/reach'), join(work, 'apps/reach'), { recursive: true });
  writeFileSync(join(work, 'apps/reach/config.json'), JSON.stringify({ target: allowed.url, other: sibling.url }));
  writeFileSync(join(work, 'product.json'), JSON.stringify({
    name: 'Endpoint Test', protocol: 'appshellendpoints', dataDirectory: 'appshell-endpoints-test',
    package: { extension: '.testapp', displayName: 'Test App' }, apps: [{ path: 'reach' }],
    policy: { capabilities: 'enforce', developerMode: true },
  }));
  const port = 9300 + Math.floor(Math.random() * 400);
  const child = spawn(electron, [
    join(root, 'packages/host'), '--product', join(work, 'product.json'), '--apps', join(work, 'apps'), '--user-data', userData,
    '--approve-endpoints', `--remote-debugging-port=${port}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  t.after(async () => {
    allowed.server.close(); sibling.server.close();
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await waitForPage(port, 'file://', "typeof host === 'object' && document.readyState === 'complete'");
  const ui = (/** @type {string} */ js) => evaluate(port, 'file://', js);
  await ui("host.open('reach')");
  const store = join(accountRoot(userData), 'apps', 'reach', 'storage.json');
  await until(() => existsSync(store) && 'report' in JSON.parse(readFileSync(store, 'utf8')));
  const { report } = JSON.parse(readFileSync(store, 'utf8'));

  assert.equal(report.before, 'blocked', 'nothing is reachable before approval');
  assert.deepEqual(report.grant, { approved: true, address: new URL(allowed.url).origin });
  assert.equal(report.after, 'allowed-address');
  assert.equal(report.sibling, 'blocked', 'a different port stays blocked');
  assert.match(report.outside, /INVALID_PARAMS/, 'plain http to a public host is refused');
  assert.deepEqual(report.listed, [new URL(allowed.url).origin]);
  assert.deepEqual(await ui('document.querySelectorAll("#endpoints button").length'), 1);

  await ui(`host.removeEndpoint('reach', ${JSON.stringify(new URL(allowed.url).origin)})`);
  await evaluate(port, 'app://reach', "document.getElementById('again').click()");
  await until(() => 'again' in JSON.parse(readFileSync(store, 'utf8')));
  assert.equal(JSON.parse(readFileSync(store, 'utf8')).again, 'blocked', 'removal takes effect without a restart');
});
