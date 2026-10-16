const net = require('node:net');

const rawAllowed = process.env.APPSHELL_ALLOWED_HOSTS ?? '';
delete process.env.APPSHELL_ALLOWED_HOSTS;

const allowedHosts = new Set(
  rawAllowed
    .split(',')
    .map((h) => h.trim().toLowerCase().split(':')[0])
    .filter(Boolean)
);

function isAllowed(host, port) {
  if (!host) return false;
  const clean = String(host).toLowerCase();
  return allowedHosts.has(clean) || (port !== undefined && port !== '' && allowedHosts.has(`${clean}:${port}`));
}
try {
  const dns = require('node:dns');
  const origLookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    if (hostname && !isAllowed(hostname)) {
      const err = new Error(`DNS lookup for ${hostname} denied by Appshell capability policy`);
      if (typeof cb === 'function') return process.nextTick(() => cb(err));
      throw err;
    }
    return origLookup.apply(this, arguments);
  };
  if (dns.promises) {
    const origPromisesLookup = dns.promises.lookup;
    dns.promises.lookup = function (hostname, options) {
      if (hostname && !isAllowed(hostname)) {
        return Promise.reject(new Error(`DNS lookup for ${hostname} denied by Appshell capability policy`));
      }
      return origPromisesLookup.apply(this, arguments);
    };
  }
} catch {}

try {
  const dgram = require('node:dgram');
  const origDgramSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function (...args) {
    let host = null;
    let cb = null;
    for (let i = args.length - 1; i >= 0; i--) {
      if (typeof args[i] === 'function') cb = args[i];
      else if (typeof args[i] === 'string' && !host) host = args[i];
    }
    if (host && !isAllowed(host)) {
      const err = new Error(`Network access to ${host} denied by Appshell capability policy`);
      if (cb) process.nextTick(() => cb(err));
      else process.nextTick(() => this.emit('error', err));
      return;
    }
    return origDgramSend.apply(this, args);
  };
} catch {}
const origConnect = net.Socket.prototype.connect;
function guardedConnect(...args) {
  let host = null;
  let port;
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    const opts = Array.isArray(first) ? first[0] : first;
    host = opts?.host || opts?.hostname || opts?.servername;
    port = opts?.port;
  } else if (typeof first === 'number' && typeof args[1] === 'string') {
    host = args[1];
    port = first;
  }

  if (!isAllowed(host, port)) {
    const err = new Error(`Network access to ${host ?? 'unknown'} denied by Appshell capability policy`);
    process.nextTick(() => {
      this.destroy(err);
    });
    return this;
  }
  return origConnect.apply(this, args);
}

Object.defineProperty(net.Socket.prototype, 'connect', {
  value: guardedConnect,
  writable: false,
  configurable: false,
});

if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  function guardedFetch(input, init) {
    try {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (urlStr) {
        const parsed = new URL(urlStr);
        if (!isAllowed(parsed.hostname, parsed.port)) {
          return Promise.reject(new TypeError(`Network access to ${parsed.hostname} denied by Appshell capability policy`));
        }
      }
    } catch {
      return Promise.reject(new TypeError('Invalid URL for fetch'));
    }
    return origFetch(input, init);
  }

  Object.defineProperty(globalThis, 'fetch', {
    value: guardedFetch,
    writable: false,
    configurable: false,
  });
}
