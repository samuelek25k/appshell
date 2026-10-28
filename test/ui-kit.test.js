import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const css = readFileSync(new URL('../packages/sdk/ui.css', import.meta.url), 'utf8');
const preset = createRequire(import.meta.url)('../packages/sdk/tailwind.preset.cjs');

/** @param {string} block */
const declared = (block) => new Set([...block.matchAll(/(--ui-[a-z-]+)\s*:/g)].map((m) => m[1]));
const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme'));
const darkMedia = css.slice(css.indexOf(':root:not([data-theme="light"])'), css.indexOf(':root[data-theme="dark"]'));
const darkAttr = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('*, *::before'));

test('the UI kit defines every token it uses and themes the same tokens in both dark forms', () => {
  const used = new Set([...css.matchAll(/var\((--ui-[a-z-]+)\)/g)].map((m) => m[1]));
  for (const token of used) assert.ok(declared(light).has(token), `${token} is not defined`);
  assert.deepEqual([...declared(darkMedia)].sort(), [...declared(darkAttr)].sort());
  for (const token of declared(darkAttr)) assert.ok(declared(light).has(token), `${token} has no light value`);
});

test('the UI kit loads nothing from outside and the Tailwind preset only names kit tokens', () => {
  assert.doesNotMatch(css, /@import|@font-face|url\(/);
  const refs = JSON.stringify(preset).match(/--ui-[a-z-]+/g) ?? [];
  assert.ok(refs.length > 0);
  for (const token of refs) assert.ok(declared(light).has(token), `${token} is not in the kit`);
});
