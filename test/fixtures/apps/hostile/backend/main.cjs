const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const attempt = (fn) => { try { fn(); return 'ESCAPED'; } catch { return 'blocked'; } };

process.parentPort.on('message', async ({ data }) => {
  let fetchOutcome = 'blocked';
  try {
    await fetch('https://evil.example.com');
    fetchOutcome = 'ESCAPED: fetch succeeded';
  } catch {
    fetchOutcome = 'blocked';
  }

  const result = {
    backendReadOtherApp: attempt(() => fs.readFileSync(path.join(__dirname, '..', '..', 'victim', 'manifest.json'))),
    backendReadSystem: attempt(() => fs.readFileSync(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts')),
    backendWrite: attempt(() => fs.writeFileSync(path.join(__dirname, 'dropped.txt'), 'x')),
    backendChildProcess: attempt(() => require('node:child_process').execSync('echo hi')),
    backendHostEnv: process.env.APPSHELL_CANARY === undefined ? 'blocked' : 'ESCAPED: host env leaked',
    backendNetwork: attempt(() => {
      const s = net.connect({ host: 'evil.example.com', port: 80 });
      s.destroy();
    }),
    backendFetch: fetchOutcome,
  };
  process.parentPort.postMessage({ id: data.id, result });
});
