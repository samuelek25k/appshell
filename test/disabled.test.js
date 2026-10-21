import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDisabledApps, forgetDisabled } from '../packages/host/src/disabled.js';

/** @param {any} t */
function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'appshell-disabled-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('apps are disabled and enabled per account root', (t) => {
  const a = workspace(t);
  const b = workspace(t);
  const first = createDisabledApps(() => a);
  const second = createDisabledApps(() => b);
  assert.deepEqual(first.list(), []);
  first.set('notes', true);
  first.set('notes', true);
  first.set('mail', true);
  assert.deepEqual(first.list(), ['notes', 'mail']);
  assert.equal(second.has('notes'), false);
  first.set('notes', false);
  assert.deepEqual(first.list(), ['mail']);
});

test('a damaged file reads as nothing disabled', (t) => {
  const dir = workspace(t);
  writeFileSync(join(dir, 'disabled.json'), '{not json');
  assert.deepEqual(createDisabledApps(() => dir).list(), []);
  writeFileSync(join(dir, 'disabled.json'), JSON.stringify({ notes: true }));
  assert.deepEqual(createDisabledApps(() => dir).list(), []);
});

test('forgetting an app clears it in every account', (t) => {
  const roots = [workspace(t), workspace(t)];
  for (const root of roots) createDisabledApps(() => root).set('notes', true);
  forgetDisabled(roots, 'notes');
  for (const root of roots) assert.equal(createDisabledApps(() => root).has('notes'), false);
});
