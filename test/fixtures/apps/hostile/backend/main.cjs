const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const attempt = (fn) => { try { fn(); return 'ESCAPED'; } catch { return 'blocked'; } };

process.parentPort.on('message', async ({ data }) => {
  const byPolicy = (error) => (/denied by Appshell/.test(String(error?.message)) ? 'blocked' : `ESCAPED: ${error?.message ?? 'connected'}`);
  const fetchOutcome = await fetch('https://evil.example.com').then(() => 'ESCAPED: fetch succeeded', byPolicy);
  const netOutcome = await new Promise((resolve) => {
    const socket = net.connect({ host: 'evil.example.com', port: 80 });
    socket.on('connect', () => { socket.destroy(); resolve('ESCAPED: connected'); });
    socket.on('error', (error) => resolve(byPolicy(error)));
  });

  let netOutcome = 'blocked';
  try {
    await new Promise((resolve, reject) => {
      const s = net.connect({ host: 'evil.example.com', port: 80 });
      s.on('error', (err) => {
        if (err.message.includes('denied by Appshell capability policy')) {
          resolve();
        } else {
          reject(err);
        }
      });
      s.on('connect', () => {
        s.destroy();
        reject(new Error('connected'));
      });
      setTimeout(() => { s.destroy(); resolve(); }, 600);
    });
  } catch (err) {
    netOutcome = `ESCAPED: ${err.message}`;
  }

  const result = {
    backendReadOtherApp: attempt(() => fs.readFileSync(path.join(__dirname, '..', '..', 'victim', 'manifest.json'))),
    backendReadSystem: attempt(() => fs.readFileSync(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts')),
    backendWrite: attempt(() => fs.writeFileSync(path.join(__dirname, 'dropped.txt'), 'x')),
    backendChildProcess: attempt(() => require('node:child_process').execSync('echo hi')),
    backendHostEnv: process.env.APPSHELL_CANARY === undefined ? 'blocked' : 'ESCAPED: host env leaked',
    backendNetwork: netOutcome,
    backendFetch: fetchOutcome,
  };
  process.parentPort.postMessage({ id: data.id, result });
});
