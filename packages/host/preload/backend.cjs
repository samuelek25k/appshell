const net = require('node:net');

const rawAllowed = process.env.APPSHELL_ALLOWED_HOSTS ?? '';
delete process.env.APPSHELL_ALLOWED_HOSTS;

const allowedHosts = new Set(
  rawAllowed
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

function isAllowed(host) {
  if (!host) return false;
  const clean = String(host).split(':')[0].toLowerCase();
  return allowedHosts.has(clean);
}

const origConnect = net.Socket.prototype.connect;
function guardedConnect(...args) {
  let host = null;
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    if (Array.isArray(first)) {
      const opts = first[0];
      host = opts?.host || opts?.hostname || opts?.servername;
    } else {
      host = first.host || first.hostname || first.servername;
    }
  } else if (typeof first === 'number' && typeof args[1] === 'string') {
    host = args[1];
  }

  if (!isAllowed(host)) {
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
        if (!isAllowed(parsed.hostname)) {
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
