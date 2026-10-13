// Phase 0 gate: a hostile app must fail every escape attempt, and the victim's data must survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const electron = /** @type {string} */ (createRequire(import.meta.url)('electron'));

/** @param {string} file */
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };

test('hostile app cannot escape its sandbox', { timeout: 90_000 }, async (t) => {
  const userData = mkdtempSync(join(tmpdir(), 'appshell-e2e-'));
  /** One deep link per launch: Windows exits at once when given two. @param {string} link */
  const launch = (link) => spawn(electron, [
    join(root, 'packages/host'),
    '--product', join(root, 'test/fixtures/product.json'),
    '--user-data', userData,
    link,
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
  ], { env: { ...process.env, APPSHELL_CANARY: 'canary-value', ELECTRON_ENABLE_LOGGING: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });

  const child = launch('appshelltest://victim/');
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  // Open the hostile app the way users would: a second launch hands its link to the running host.
  for (let waited = 0; !readJson(join(userData, 'apps', 'victim', 'storage.json')).ready && waited < 30_000; waited += 250) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await once(launch('appshelltest://hostile/'), 'exit');

  const reportFile = join(userData, 'apps', 'hostile', 'storage.json');
  let report;
  for (let waited = 0; !report && waited < 60_000; waited += 500) {
    await new Promise((r) => setTimeout(r, 500));
    report = readJson(reportFile).report;
    if (child.exitCode !== null) break;
  }
  // CI prints this file when the job fails, so results are visible without the full log.
  if (process.env.APPSHELL_E2E_REPORT) {
    const tail = (/** @type {string} */ f) => { try { return readFileSync(join(userData, 'logs', f), 'utf8').slice(-700); } catch { return null; } };
    writeFileSync(process.env.APPSHELL_E2E_REPORT, JSON.stringify(report ?? {
      exitCode: child.exitCode, stderr: stderr.split('\n').filter((l) => !l.includes('dbus')).join('\n').slice(-1800), host: tail('host.log'), hostile: tail('hostile.log'), victim: tail('victim.log'),
    }));
  }
  assert.ok(report, `hostile app produced no report.\n${stderr.split('\n').filter((l) => !l.includes('dbus')).slice(-20).join('\n')}`);

  const escaped = Object.entries(report).filter(([, outcome]) => outcome !== 'blocked');
  assert.deepEqual(escaped, [], `escapes: ${JSON.stringify(escaped, null, 2)}`);
  assert.ok(Object.keys(report).length >= 20, `expected every check to report, got ${Object.keys(report).join(', ')}`);

  const victim = readJson(join(userData, 'apps', 'victim', 'storage.json'));
  assert.equal(victim.token, 'victim-token', 'victim data was changed or never written');
});
