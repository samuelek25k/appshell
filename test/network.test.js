import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { networkAllowed } from '../packages/contracts/index.js';

const manifest = {
  id: 'ops.monitor', version: '1.0.0', title: 'Monitor', publisher: 'Ops',
  engines: { appshell: '^0.1' }, entry: { ui: 'ui/index.html' },
  widgets: [{ id: 'delays', title: 'Delays' }],
  capabilities: { network: ['api.example.com'], secrets: ['api-key'] },
};

test('network allows own origin and declared hosts only', () => {
  assert.equal(networkAllowed(manifest, 'app://ops.monitor/ui/index.html'), true);
  assert.equal(networkAllowed(manifest, 'app://other.app/'), false);
  assert.equal(networkAllowed(manifest, 'https://api.example.com/x'), true);
  assert.equal(networkAllowed(manifest, 'https://evil.example.com/x'), false);
  assert.equal(networkAllowed(manifest, 'http://api.example.com/x'), false);
});

test('backend network preload blocks undeclared network connections', async () => {
  const preload = realpathSync(fileURLToPath(new URL('../packages/host/preload/backend.cjs', import.meta.url)));
  const script = `
    const net = require('node:net');
    let netBlocked = false;
    let fetchBlocked = false;
    function checkDone() {
      if (netBlocked && fetchBlocked) {
        process.stdout.write('BLOCKED_ALL');
        process.exit(0);
      }
    }
    const s = net.connect({ host: 'evil.com', port: 80 });
    s.on('error', (e) => {
      if (e.message.includes('denied by Appshell capability policy')) netBlocked = true;
      checkDone();
    });
    fetch('https://evil.com')
      .then(() => process.exit(1))
      .catch((e) => {
        if (e.message.includes('denied by Appshell capability policy')) fetchBlocked = true;
        checkDone();
      });
  `;

  const child = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${preload}`,
    `--require=${preload}`,
    '-e', script,
  ], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: 'api.example.com' },
    encoding: 'utf8',
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'BLOCKED_ALL');
});

test('backend network preload strips ports in allowedHosts and blocks UDP and DNS', async () => {
  const preload = realpathSync(fileURLToPath(new URL('../packages/host/preload/backend.cjs', import.meta.url)));
  const script = `
    const dns = require('node:dns');
    const dgram = require('node:dgram');
    let dnsBlocked = false;
    let dgramBlocked = false;
    dns.lookup('evil.com', (err) => {
      if (err && err.message.includes('denied by Appshell capability policy')) dnsBlocked = true;
      const s = dgram.createSocket('udp4');
      s.send('hi', 1234, 'evil.com', (e) => {
        s.close();
        if (e && e.message.includes('denied by Appshell capability policy')) dgramBlocked = true;
        if (dnsBlocked && dgramBlocked) {
          process.stdout.write('BLOCKED_UDP_DNS');
          process.exit(0);
        }
      });
    });
  `;

  const child = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${preload}`,
    `--require=${preload}`,
    '-e', script,
  ], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: 'api.example.com:8443' },
    encoding: 'utf8',
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'BLOCKED_UDP_DNS');
});

test('backend network preload honours ports on declared hosts', async () => {
  const preload = realpathSync(fileURLToPath(new URL('../packages/host/preload/backend.cjs', import.meta.url)));
  const script = `
    const net = require('node:net');
    const denied = (port) => new Promise((resolve) => {
      const s = net.connect({ host: 'api.example.com', port });
      s.on('connect', () => { s.destroy(); resolve(false); });
      s.on('error', (e) => resolve(e.message.includes('denied by Appshell')));
    });
    Promise.all([denied(8443), denied(80)]).then(([declared, other]) => process.stdout.write(JSON.stringify({ declared, other })));
  `;
  const child = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${preload}`, `--require=${preload}`, '-e', script], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: 'api.example.com:8443' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(child.stdout), { declared: false, other: true });
});
