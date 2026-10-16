import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const probeFile = realpathSync(fileURLToPath(new URL('../packages/host/src/probe.cjs', import.meta.url)));
const probeDir = dirname(probeFile);
const preloadFile = realpathSync(fileURLToPath(new URL('../packages/host/preload/backend.cjs', import.meta.url)));

test('backend probe fails when permission model is missing', () => {
  const res = spawnSync(process.execPath, [probeFile], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: '' },
  });
  assert.equal(res.status, 1);
});

test('backend probe fails when network preload is omitted', () => {
  const res = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${probeDir}`,
    probeFile,
  ], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: '' },
  });
  assert.equal(res.status, 1);
});

test('backend probe succeeds when permission model and preload are active', () => {
  const res = spawnSync(process.execPath, [
    '--permission',
    `--allow-fs-read=${probeDir}`,
    `--allow-fs-read=${preloadFile}`,
    `--require=${preloadFile}`,
    probeFile,
  ], {
    env: { ...process.env, APPSHELL_ALLOWED_HOSTS: '' },
  });
  assert.equal(res.status, 0);
});
