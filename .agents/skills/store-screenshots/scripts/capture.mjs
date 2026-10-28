import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [appDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!appDir || !outDir) throw new Error('usage: capture.mjs <app-dir> <out-dir>');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const electron = createRequire(join(root, 'package.json'))('electron');
const { id } = JSON.parse(readFileSync(join(appDir, 'manifest.json'), 'utf8'));

const work = mkdtempSync(join(tmpdir(), 'appshell-shots-'));
writeFileSync(join(work, 'product.json'), JSON.stringify({
  name: 'Appshell', protocol: 'appshellshots', dataDirectory: 'appshell-shots',
  package: { extension: '.tgz', displayName: 'App' }, apps: [{ path: appDir }],
  policy: { capabilities: 'enforce', developerMode: true },
}));
const port = 9500 + Math.floor(Math.random() * 300);
const child = spawn(electron, [join(root, 'packages/host'), '--product', join(work, 'product.json'), '--user-data', join(work, 'data'),
  `--remote-debugging-port=${port}`, `appshellshots://${id}/`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function send(prefix, method, params = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.url.startsWith(prefix));
  if (!target) throw new Error(`no page ${prefix}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send(JSON.stringify({ id: 1, method, params }));
  const reply = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(String(m.data))); });
  ws.close();
  return reply.result;
}
const shot = async (prefix, file) => {
  const { data } = await send(prefix, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
  console.log(join(outDir, file));
};

try {
  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < 60; i++) { try { await send(`app://${id}`, 'Runtime.evaluate', { expression: '1' }); break; } catch { await sleep(500); } }
  await sleep(2500);
  const prepare = join(appDir, 'store', 'prepare.js');
  if (existsSync(prepare)) {
    await send(`app://${id}`, 'Runtime.evaluate', { expression: readFileSync(prepare, 'utf8'), awaitPromise: true });
    await sleep(1000);
  }
  for (const theme of ['light', 'dark']) {
    const suffix = theme === 'dark' ? '-dark' : '';
    await send('file://', 'Runtime.evaluate', { expression: `host.setTheme('${theme}')`, awaitPromise: true });
    await sleep(1000);
    await send('file://', 'Runtime.evaluate', { expression: `host.open('${id}')`, awaitPromise: true });
    await sleep(800);
    await shot(`app://${id}`, `screenshot-1${suffix}.png`);
    await send('file://', 'Runtime.evaluate', { expression: 'host.home()', awaitPromise: true });
    await sleep(800);
    await shot('file://', `screenshot-2${suffix}.png`);
  }
} finally {
  child.kill();
}
