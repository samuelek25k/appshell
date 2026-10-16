import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} dir @returns {string[]} */
const files = (dir) => readdirSync(dir).flatMap((name) => {
  if (name === 'node_modules') return [];
  const full = join(dir, name);
  return statSync(full).isDirectory() ? files(full) : [full];
});

const products = readdirSync(join(root, 'products')).map((name) =>
  JSON.parse(readFileSync(join(root, 'products', name, 'product.json'), 'utf8')));

test('no product names, protocols, folders or package formats in packages/', () => {
  const terms = products.flatMap((p) => [p.name, p.protocol, p.dataDirectory, p.package.extension, p.package.displayName])
    .map((t) => t.toLowerCase())
    .filter((t) => !t.includes('appshell'));
  const hits = files(join(root, 'packages')).flatMap((file) => {
    const text = readFileSync(file, 'utf8').toLowerCase();
    return terms.filter((term) => text.includes(term)).map((term) => `${file.slice(root.length)}: ${term}`);
  });
  assert.deepEqual(hits, []);
});

test('no product-specific app names or personal data in packages/', () => {
  const forbidden = [
    'pomodoro',
    'quick-notes',
    'world-clock',
    'clipboard-manager',
    'color-picker',
    'markdown-preview',
    'alex morgan',
    'alex.morgan',
  ];
  const hits = files(join(root, 'packages')).flatMap((file) => {
    const text = readFileSync(file, 'utf8').toLowerCase();
    return forbidden.filter((term) => text.includes(term)).map((term) => `${file.slice(root.length)}: ${term}`);
  });
  assert.deepEqual(hits, []);
});
