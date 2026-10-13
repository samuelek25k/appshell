// Backend attacks: runs inside the per-app utilityProcess.
const fs = require('node:fs');
const path = require('node:path');

const attempt = (fn) => { try { fn(); return 'ESCAPED'; } catch { return 'blocked'; } };

process.parentPort.on('message', ({ data }) => {
  const result = {
    backendReadOtherApp: attempt(() => fs.readFileSync(path.join(__dirname, '..', '..', 'victim', 'manifest.json'))),
    backendReadSystem: attempt(() => fs.readFileSync(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts')),
    backendWrite: attempt(() => fs.writeFileSync(path.join(__dirname, 'dropped.txt'), 'x')),
    backendChildProcess: attempt(() => require('node:child_process').execSync('echo hi')),
    backendHostEnv: process.env.APPSHELL_CANARY === undefined ? 'blocked' : 'ESCAPED: host env leaked',
  };
  process.parentPort.postMessage({ id: data.id, result });
});
