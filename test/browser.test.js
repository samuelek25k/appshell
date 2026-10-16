import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserManager } from '../packages/host/src/browser.js';

test('browserManager enforces URL protocols and capability domain restrictions', async () => {
  /** @type {any[]} */
  const audited = [];
  const manager = createBrowserManager({
    developerMode: false,
    audit: (entry) => audited.push(entry),
  });

  const manifest = {
    id: 'agent.app',
    version: '1.0.0',
    title: 'Agent',
    publisher: 'Org',
    engines: { appshell: '^0.1' },
    entry: {},
    capabilities: {
      browser: { allowedDomains: ['example.com'] },
    },
  };

  await assert.rejects(
    () => manager.navigate('agent.app', manifest, 'not-a-url'),
    { code: 'INVALID_PARAMS' },
  );

  await assert.rejects(
    () => manager.navigate('agent.app', manifest, 'file:///etc/passwd'),
    { code: 'CAPABILITY_DENIED' },
  );

  await assert.rejects(
    () => manager.navigate('agent.app', manifest, 'http://example.com'),
    { code: 'CAPABILITY_DENIED' },
  );

  await assert.rejects(
    () => manager.navigate('agent.app', manifest, 'https://evil.com'),
    { code: 'CAPABILITY_DENIED' },
  );
});

test('browserManager interacts with page via actions, extraction, evaluation and lifecycle', async () => {
  /** @type {string[]} */
  const executedScripts = [];
  /** @type {any[]} */
  const audited = [];
  let closed = false;

  const mockWebContents = {
    /** @param {string} _url */
    loadURL: async (_url) => {},
    getTitle: () => 'Test Title',
    getURL: () => 'https://example.com/portal',
    isLoading: () => false,
    /**
     * @param {string} script
     * @param {boolean} _userGesture
     */
    executeJavaScript: async (script, _userGesture) => {
      executedScripts.push(script);
      if (script.includes('#missing')) throw new Error('element not found: #missing');
      if (script.includes('#btn')) return true;
      if (script.includes('outerHTML')) return '<h1>Title</h1>';
      if (script.includes('innerText')) return 'Extracted Title';
      if (script === '2 + 2') return 4;
      return true;
    },
    capturePage: async () => ({
      toDataURL: () => 'data:image/png;base64,sample',
    }),
    close: () => {
      closed = true;
    },
  };

  const manager = createBrowserManager({
    developerMode: true,
    audit: (entry) => audited.push(entry),
    viewFactory: () => ({ webContents: mockWebContents }),
  });

  const manifest = {
    id: 'agent.app',
    version: '1.0.0',
    title: 'Agent',
    publisher: 'Org',
    engines: { appshell: '^0.1' },
    entry: {},
    capabilities: { browser: true },
  };

  const navRes = await manager.navigate('agent.app', manifest, 'http://localhost:3000');
  assert.equal(navRes.url, 'https://example.com/portal');
  assert.equal(navRes.title, 'Test Title');

  const statusBefore = await manager.status('agent.app');
  assert.equal(statusBefore.active, true);
  assert.equal(statusBefore.title, 'Test Title');

  const actClick = await manager.act('agent.app', { action: 'click', selector: '#btn' });
  assert.equal(actClick.success, true);

  await assert.rejects(
    () => manager.act('agent.app', { action: 'click', selector: '#missing' }),
    { code: 'ACTION_FAILED' },
  );

  const actType = await manager.act('agent.app', { action: 'type', selector: '#inp', value: 'hello' });
  assert.equal(actType.success, true);

  const actPress = await manager.act('agent.app', { action: 'press', selector: '#inp', value: 'Enter' });
  assert.equal(actPress.success, true);

  const actSelect = await manager.act('agent.app', { action: 'select', selector: '#sel', value: 'option-1' });
  assert.equal(actSelect.success, true);

  const extractText = await manager.extract('agent.app', { selector: 'h1', format: 'text' });
  assert.equal(extractText.value, 'Extracted Title');

  const extractHtml = await manager.extract('agent.app', { selector: 'h1', format: 'html' });
  assert.equal(extractHtml.value, '<h1>Title</h1>');

  const evalRes = await manager.evaluate('agent.app', { script: '2 + 2' });
  assert.equal(evalRes.result, 4);

  const shotRes = await manager.screenshot('agent.app');
  assert.equal(shotRes.dataUrl, 'data:image/png;base64,sample');

  const closeRes = await manager.close('agent.app');
  assert.equal(closeRes.closed, true);
  assert.equal(closed, true);

  const statusAfter = await manager.status('agent.app');
  assert.equal(statusAfter.active, false);

  assert.ok(audited.some((e) => e.event === 'BROWSER_NAVIGATED'));
  assert.ok(audited.some((e) => e.event === 'BROWSER_ACTION'));
  assert.ok(audited.some((e) => e.event === 'BROWSER_CLOSED'));
});
