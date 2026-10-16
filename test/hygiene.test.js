import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { check, checkMessage, strip } from '../scripts/hygiene.mjs';

test('the repository has no comments outside type tags', () => {
  const out = execFileSync('node', ['scripts/hygiene.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out, '');
});

test('comments are found in each language, strings and regexes are not', () => {
  assert.equal(check('a.js', 'const u = "http://x"; const r = /\\/*x/; const t = `//${a}//`;').length, 0);
  assert.equal(check('a.js', 'x(); // why').length, 1);
  assert.equal(check('a.js', '/* note */ x();').length, 1);
  assert.equal(check('a.css', 'a { b: "/*" } /* c */').length, 1);
  assert.equal(check('a.html', '<p>x</p><!-- y -->').length, 1);
  assert.equal(check('a.yml', 'run: echo "#x" # y\n# z').length, 2);
  assert.equal(check('a.sh', '#!/bin/sh\necho ${#x}').length, 0);
});

test('type tags pass, prose does not', () => {
  assert.equal(check('a.js', '/** @param {string} id @returns {number} */').length, 0);
  assert.equal(check('a.js', '/**\n * @typedef {{\n *   a: string,\n * }} T\n */').length, 0);
  assert.equal(check('a.js', 'const x = /** @type {any} */ (y);').length, 0);
  assert.equal(check('a.js', '/** Does a thing. @param {string} id */').length, 1);
  assert.equal(check('a.js', '/** @param {string} id the app id */').length, 1);
});

test('fixing removes prose and keeps type tags', () => {
  assert.equal(strip('a.js', 'x(); // why\n'), 'x();\n');
  assert.equal(strip('a.js', '// header\nx();\n'), 'x();\n');
  assert.equal(strip('a.js', '/** Does a thing. @param {string} id */\nf();\n'), '/** @param {string} id */\nf();\n');
});

test('commit messages may not carry AI attribution', () => {
  assert.equal(checkMessage('fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>').length > 0, true);
  assert.equal(checkMessage('fix: x').length, 0);
});
