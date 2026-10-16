const fs = require('node:fs');
const cp = require('node:child_process');
const dns = require('node:dns');
const net = require('node:net');
const path = require('node:path');

async function runProbe() {
  if (!process.permission || typeof process.permission.has !== 'function') {
    throw new Error('PERMISSION_MODEL_INACTIVE');
  }

  let fsBlocked = false;
  try {
    fs.readFileSync(path.resolve(__dirname, '..', 'probe-forbidden-read-test'));
  } catch (err) {
    if (err && err.code === 'ERR_ACCESS_DENIED') {
      fsBlocked = true;
    }
  }
  if (!fsBlocked) throw new Error('FS_READ_NOT_RESTRICTED');

  let cpBlocked = false;
  try {
    cp.spawn(process.execPath, ['-v']);
  } catch (err) {
    if (err && err.code === 'ERR_ACCESS_DENIED') {
      cpBlocked = true;
    }
  }
  if (!cpBlocked) throw new Error('CHILD_PROCESS_NOT_RESTRICTED');

  let socketBlocked = false;
  await new Promise((resolve) => {
    const s = net.connect(80, '127.0.0.1');
    s.on('error', (err) => {
      if (err && String(err.message).includes('denied by Appshell capability policy')) {
        socketBlocked = true;
      }
      resolve(null);
    });
    s.on('connect', () => {
      s.destroy();
      resolve(null);
    });
  });
  if (!socketBlocked) throw new Error('SOCKET_NOT_RESTRICTED');

  let dnsBlocked = false;
  try {
    dns.lookup('example.com', () => {});
  } catch {
    dnsBlocked = true;
  }
  if (!dnsBlocked) {
    await new Promise((resolve, reject) => {
      dns.lookup('example.com', (err) => {
        if (err && String(err.message).includes('denied by Appshell capability policy')) {
          resolve(true);
        } else {
          reject(new Error('DNS_LOOKUP_NOT_RESTRICTED'));
        }
      });
    });
  }

  return true;
}

runProbe()
  .then(() => {
    process.parentPort?.postMessage({ ok: true });
    process.exit(0);
  })
  .catch((err) => {
    process.parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
