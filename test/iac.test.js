import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate, METHODS, allowsIacReceive } from '../packages/contracts/index.js';
import { createServices } from '../packages/host/src/services.js';
import { createBridge } from '../packages/host/src/bridge.js';

/**
 * @param {any} t
 * @param {string} prefix
 */
function createTempWorkspace(t, prefix = 'appshell-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bridge enforces blockedApps and audits denial on IAC', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-bridge-');
  const services = createServices(dir);
  const bridge = createBridge({
    policy: { capabilities: 'enforce', blockedApps: ['banned-app'] },
    services,
    backendFor: () => (/** @type {any} */ ({})),
    identity: /** @type {any} */ ({ mint: () => ({ token: 'mock' }), publicJwk: () => ({}) }),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    hostLog: () => {},
    canReceiveIac: () => true,
    onIacSend: async () => ({ delivered: true, targetRunning: true }),
  });

  const senderApp = {
    manifest: {
      id: 'sender', version: '1.0.0', title: 'Sender', publisher: 'Appshell',
      engines: { appshell: '^0.1' }, entry: { ui: 'index.html' },
      capabilities: { iac: { send: ['allowed-app', 'banned-app'] } },
    },
    dir,
    protected: false,
  };

  const okRes = await bridge(senderApp, 'iac.send', { to: 'allowed-app', action: 'ping', payload: {} });
  assert.equal(okRes.ok, true);

  const blockedRes = await bridge(senderApp, 'iac.send', { to: 'banned-app', action: 'ping', payload: {} });
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.error.code, 'CAPABILITY_DENIED');

  const auditLines = readFileSync(join(dir, 'logs', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const blockedAudit = auditLines.find((a) => a.event === 'IAC_DENIED');
  assert.ok(blockedAudit);
  assert.equal(blockedAudit.details.to, 'banned-app');
});

test('IAC schema validation and capability checking', () => {
  const base = {
    id: 'app.a', version: '1.0.0', title: 'App A', publisher: 'Org',
    engines: { appshell: '^0.1' }, entry: { ui: 'ui/index.html' },
  };

  assert.equal(validate('manifest', { ...base, capabilities: { iac: true } }).ok, true);

  assert.equal(validate('manifest', {
    ...base,
    capabilities: {
      iac: {
        send: ['app.b', 'app.c'],
        receive: ['app.b'],
        channels: ['finance.ticker'],
      },
    },
  }).ok, true);

  assert.equal(validate('manifest', { ...base, capabilities: { iac: 12345 } }).ok, false);

  const scopedManifest = {
    ...base,
    capabilities: {
      iac: {
        send: ['app.b'],
        receive: ['*'],
        channels: ['news'],
      },
    },
  };

  assert.equal(METHODS['iac.send'].requires(base, { to: 'app.b', action: 'ping' }), 'iac');
  assert.equal(METHODS['iac.send'].requires(scopedManifest, { to: 'app.b', action: 'ping' }), null);
  assert.equal(METHODS['iac.send'].requires(scopedManifest, { to: 'app.unauthorized', action: 'ping' }), 'iac:send:app.unauthorized');

  assert.equal(METHODS['iac.publish'].requires(base, { channel: 'news', data: { ok: true } }), 'iac');
  assert.equal(METHODS['iac.publish'].requires(scopedManifest, { channel: 'news', data: { ok: true } }), null);
  assert.equal(METHODS['iac.publish'].requires(scopedManifest, { channel: 'secret-channel', data: 1 }), 'iac:channel:secret-channel');

  assert.equal(allowsIacReceive(base, 'app.b'), false);
  assert.equal(allowsIacReceive({ ...base, capabilities: { iac: true } }, 'app.b'), true);
  assert.equal(allowsIacReceive({ ...base, capabilities: { iac: { receive: ['app.b'] } } }, 'app.b'), true);
  assert.equal(allowsIacReceive({ ...base, capabilities: { iac: { receive: ['app.c'] } } }, 'app.b'), false);
});

test('bridge mediates IAC messaging, verifies permissions, and audits events', async (t) => {
  const dir = createTempWorkspace(t, 'appshell-iac-');
  const services = createServices(dir);

  /** @type {{ to: string, from: string, action: string, payload: unknown }[]} */
  const deliveredMessages = [];
  /** @type {Map<string, Set<string>>} */
  const subscriptions = new Map();
  /** @type {{ channel: string, from: string, data: unknown }[]} */
  const deliveredBroadcasts = [];

  /** @type {Record<string, any>} */
  const appManifests = {
    'sender.app': {
      id: 'sender.app', version: '1.0.0', title: 'Sender', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
      capabilities: { iac: { send: ['receiver.app', 'blocked.app'], channels: ['events'] } },
    },
    'receiver.app': {
      id: 'receiver.app', version: '1.0.0', title: 'Receiver', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
      capabilities: { iac: { receive: ['sender.app'], channels: ['events'] } },
    },
    'unauthorized.receiver': {
      id: 'unauthorized.receiver', version: '1.0.0', title: 'No IAC', publisher: 'Org',
      engines: { appshell: '^0.1' }, entry: {},
      capabilities: {},
    },
  };

  const bridge = createBridge({
    policy: { blockedApps: ['blocked.app'] },
    services,
    identity: /** @type {any} */ ({}),
    hostLog: () => {},
    backendFor: /** @type {any} */ (() => {}),
    onTitle: () => {},
    onWidget: () => {},
    onCloseResponse: () => {},
    canReceiveIac: (targetId, fromId) => {
      const target = appManifests[targetId];
      if (!target) return false;
      return allowsIacReceive(target, fromId);
    },
    onIacSend: async (fromId, toId, action, payload) => {
      deliveredMessages.push({ from: fromId, to: toId, action, payload });
      return { delivered: true, targetRunning: true };
    },
    onIacSubscribe: (appId, channel) => {
      let set = subscriptions.get(channel);
      if (!set) { set = new Set(); subscriptions.set(channel, set); }
      set.add(appId);
      return true;
    },
    onIacUnsubscribe: (appId, channel) => {
      const set = subscriptions.get(channel);
      if (set) set.delete(appId);
      return true;
    },
    onIacPublish: (fromId, channel, data) => {
      const subs = subscriptions.get(channel) ?? new Set();
      let count = 0;
      for (const sub of subs) {
        if (sub !== fromId) {
          deliveredBroadcasts.push({ channel, from: fromId, data });
          count++;
        }
      }
      return { subscribersCount: count };
    },
  });

  const sender = { manifest: appManifests['sender.app'], dir: '', protected: false };

  const sendRes = await bridge(sender, 'iac.send', { to: 'receiver.app', action: 'document.open', payload: { docId: '123' } });
  assert.equal(sendRes.ok, true);
  assert.equal(deliveredMessages.length, 1);
  assert.equal(deliveredMessages[0].from, 'sender.app');
  assert.equal(deliveredMessages[0].to, 'receiver.app');
  assert.equal(deliveredMessages[0].action, 'document.open');
  assert.deepEqual(deliveredMessages[0].payload, { docId: '123' });

  const deniedRes = await bridge(sender, 'iac.send', { to: 'unauthorized.receiver', action: 'ping' });
  assert.equal(deniedRes.ok, false);
  assert.equal(deniedRes.error.code, 'CAPABILITY_DENIED');

  const blockedRes = await bridge(sender, 'iac.send', { to: 'blocked.app', action: 'ping' });
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.error.code, 'CAPABILITY_DENIED');

  const subRes = await bridge(sender, 'iac.subscribe', { channel: 'events' });
  assert.equal(subRes.ok, true);
  assert.equal(subscriptions.get('events')?.has('sender.app'), true);

  const receiver = { manifest: appManifests['receiver.app'], dir: '', protected: false };
  await bridge(receiver, 'iac.subscribe', { channel: 'events' });

  const pubRes = await bridge(sender, 'iac.publish', { channel: 'events', data: { status: 'ready' } });
  assert.equal(pubRes.ok, true);
  assert.equal(deliveredBroadcasts.length, 1);
  assert.equal(deliveredBroadcasts[0].from, 'sender.app');
  assert.deepEqual(deliveredBroadcasts[0].data, { status: 'ready' });

  const unsubRes = await bridge(receiver, 'iac.unsubscribe', { channel: 'events' });
  assert.equal(unsubRes.ok, true);
  assert.equal(subscriptions.get('events')?.has('receiver.app'), false);

  const auditLines = readFileSync(join(dir, 'logs', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sentAudit = auditLines.find((a) => a.event === 'IAC_MESSAGE_SENT');
  const deniedAudit = auditLines.find((a) => a.event === 'IAC_DENIED');
  const pubAudit = auditLines.find((a) => a.event === 'IAC_PUBLISHED');
  assert.ok(sentAudit);
  assert.ok(deniedAudit);
  assert.ok(pubAudit);
});
