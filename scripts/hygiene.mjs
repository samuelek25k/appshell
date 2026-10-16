import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const C_LIKE = new Set(['.js', '.mjs', '.cjs', '.ts', '.swift']);
const HASH = new Set(['.sh', '.yml', '.yaml']);
const TYPE_TAGS = new Set(['type', 'param', 'returns', 'return', 'typedef', 'template', 'import', 'satisfies', 'property', 'callback', 'this', 'enum', 'overload']);
const NAMED_TAGS = new Set(['param', 'typedef', 'template', 'property', 'callback']);
const TS_DIRECTIVE = /^\s*@ts-(expect-error|ignore|check|nocheck)\s*$/;
const AI_TRAILERS = [/co-authored-by:.*(claude|anthropic)/i, /claude-session:/i, /generated with \[?claude/i, /noreply@anthropic\.com/i];

/** @typedef {{ start: number, end: number, block: boolean, text: string }} Comment */

const kindOf = (/** @type {string} */ file) => {
  const name = basename(file);
  if (file.startsWith('.husky/') && name !== '_' && !file.startsWith('.husky/_/')) return 'hash';
  if (file.startsWith('.githooks/') || name === '.gitignore') return 'hash';
  const ext = extname(file);
  if (C_LIKE.has(ext)) return 'c';
  if (ext === '.css') return 'css';
  if (ext === '.html' || ext === '.svg') return 'html';
  if (HASH.has(ext)) return 'hash';
  return null;
};

const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|void|yield|await|delete|throw|new)$/;

/** @param {string} src @returns {Comment[]} */
export function scanC(src, { regex = true } = {}) {
  /** @type {Comment[]} */
  const comments = [];
  let i = 0;
  let prev = '';
  /** @type {string[]} */
  const braces = [];
  const n = src.length;
  if (src.startsWith('#!')) i = src.indexOf('\n') === -1 ? n : src.indexOf('\n');
  const skipString = (/** @type {string} */ q) => {
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') i++;
      i++;
    }
    i++;
  };
  const skipTemplate = () => {
    i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { braces.push('tpl'); i += 2; return 'expr'; }
      i++;
    }
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      comments.push({ start: i, end: stop, block: false, text: src.slice(i + 2, stop) });
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      comments.push({ start: i, end: stop, block: true, text: src.slice(i + 2, stop - 2) });
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") { skipString(ch); prev = 'x'; continue; }
    if (ch === '`') { skipTemplate(); prev = 'x'; continue; }
    if (ch === '{') { braces.push('code'); prev = ch; i++; continue; }
    if (ch === '}') {
      const top = braces.pop();
      i++;
      if (top === 'tpl') {
        i--;
        skipTemplateRest();
        prev = 'x';
        continue;
      }
      prev = ch;
      continue;
    }
    if (regex && ch === '/' && (REGEX_BEFORE.has(prev) || REGEX_KEYWORDS.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(ch)) prev = /[\w$)\].]/.test(ch) ? 'x' : ch;
    i++;
  }
  return comments;

  function skipTemplateRest() {
    i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { braces.push('tpl'); i += 2; return; }
      i++;
    }
  }
}

/** @param {string} src @returns {Comment[]} */
export function scanCss(src) {
  /** @type {Comment[]} */
  const comments = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      comments.push({ start: i, end: stop, block: true, text: src.slice(i + 2, stop - 2) });
      i = stop;
      continue;
    }
    i++;
  }
  return comments;
}

/** @param {string} src @returns {Comment[]} */
export function scanHtml(src) {
  /** @type {Comment[]} */
  const comments = [];
  const re = /<!--[\s\S]*?-->/g;
  for (let m; (m = re.exec(src));) comments.push({ start: m.index, end: m.index + m[0].length, block: true, text: m[0] });
  return comments;
}

/** @param {string} src @returns {Comment[]} */
export function scanHash(src) {
  /** @type {Comment[]} */
  const comments = [];
  let offset = 0;
  const lines = src.split('\n');
  lines.forEach((/** @type {string} */ line, /** @type {number} */ index) => {
    if (!(index === 0 && line.startsWith('#!'))) {
      let quote = '';
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (quote) { if (ch === '\\' && quote === '"') j++; else if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '#' && (j === 0 || /\s/.test(line[j - 1]))) {
          comments.push({ start: offset + j, end: offset + line.length, block: false, text: line.slice(j + 1) });
          break;
        }
      }
    }
    offset += line.length + 1;
  });
  return comments;
}

/** @param {string} text @returns {string[] | null} */
export function typeTags(text, { strict = true } = {}) {
  const body = text.replace(/^\*/, '').split('\n').map((/** @type {string} */ l) => l.replace(/^\s*\*?\s?/, '')).join('\n').trim();
  /** @type {string[]} */
  const tags = [];
  const space = (/** @type {number} */ k) => { while (k < body.length && /\s/.test(body[k])) k++; return k; };
  let i = 0;
  while (i < body.length) {
    i = space(i);
    if (i >= body.length) break;
    const m = /^@(\w+)/.exec(body.slice(i));
    if (!m || !TYPE_TAGS.has(m[1])) {
      if (strict) return null;
      const nextTag = body.slice(i + 1).search(new RegExp(`@(${[...TYPE_TAGS].join('|')})\\b`));
      if (nextTag === -1) break;
      i += 1 + nextTag;
      continue;
    }
    let j = space(i + m[0].length);
    if (body[j] === '{') {
      let depth = 0;
      for (; j < body.length; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}' && --depth === 0) { j++; break; }
      }
      if (depth !== 0) return null;
    }
    let k = j;
    while (body[k] === ' ' || body[k] === '\t') k++;
    if (NAMED_TAGS.has(m[1])) {
      const name = /^(\[[^\]]*\]|[\w$.,]+)/.exec(body.slice(k));
      if (name) j = k + name[0].length;
    } else if (m[1] === 'import') {
      const rest = /^[^@\n]*/.exec(body.slice(k));
      j = k + (rest ? rest[0].length : 0);
    }
    tags.push(body.slice(i, j).trim());
    const after = space(j);
    if (after < body.length && body[after] !== '@' && strict) return null;
    i = j;
  }
  return tags.length ? tags : null;
}

/** @param {string[]} tags @param {string} indent @param {boolean} inline */
const rebuild = (tags, indent, inline) => {
  if (inline && tags.length === 1 && !tags[0].includes('\n')) return `/** ${tags[0]} */`;
  const lines = tags.flatMap((t) => t.split('\n'));
  return ['/**', ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`].join('\n');
};

/** @param {string} kind @param {Comment} c */
const allowed = (kind, c) => {
  if (kind !== 'c') return false;
  if (!c.block) return TS_DIRECTIVE.test(c.text);
  return c.text.startsWith('*') && typeTags(c.text) !== null;
};

/** @type {Record<string, (src: string) => Comment[]>} */
const scanners = { c: scanC, css: scanCss, html: scanHtml, hash: scanHash };

/** @param {string} file @param {string} src */
export function check(file, src) {
  const kind = kindOf(file);
  if (!kind) return [];
  const comments = kind === 'c' ? scanC(src, { regex: extname(file) !== '.swift' }) : scanners[kind](src);
  return comments.filter((c) => !allowed(kind, c)).map((c) => ({
    file, line: src.slice(0, c.start).split('\n').length, text: c.text.trim().split('\n')[0].slice(0, 80),
  }));
}

/** @param {string} file @param {string} src */
export function strip(file, src) {
  const kind = kindOf(file);
  if (!kind) return src;
  const comments = kind === 'c' ? scanC(src, { regex: extname(file) !== '.swift' }) : scanners[kind](src);
  let out = src;
  for (const c of comments.filter((x) => !allowed(kind, x)).reverse()) {
    const kept = kind === 'c' && c.block && c.text.startsWith('*') ? typeTags(c.text, { strict: false }) : null;
    if (kept) {
      const lineStart = out.lastIndexOf('\n', c.start - 1) + 1;
      const indent = out.slice(lineStart, c.start).replace(/\S.*$/, '');
      out = out.slice(0, c.start) + rebuild(kept, indent, !c.text.includes('\n')) + out.slice(c.end);
      continue;
    }
    const lineStart = out.lastIndexOf('\n', c.start - 1) + 1;
    const lineEnd = out.indexOf('\n', c.end) === -1 ? out.length : out.indexOf('\n', c.end);
    const before = out.slice(lineStart, c.start);
    const after = out.slice(c.end, lineEnd);
    if (!before.trim() && !after.trim()) out = out.slice(0, lineStart) + out.slice(Math.min(lineEnd + 1, out.length));
    else out = out.slice(0, c.start).replace(/[ \t]+$/, '') + (after.trim() ? (before.trim() ? ' ' : '') : '') + out.slice(c.end).replace(/^[ \t]+(?=\n|$)/, '');
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

/** @param {string} message */
export function checkMessage(message) {
  return AI_TRAILERS.filter((re) => re.test(message)).map((re) => `commit message matches ${re}`);
}

const tracked = () => execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--commit-msg') {
    const problems = checkMessage(readFileSync(args[1], 'utf8'));
    problems.forEach((p) => console.error(p));
    process.exit(problems.length ? 1 : 0);
  }
  const fix = args[0] === '--fix';
  const files = (fix ? args.slice(1) : args).length ? (fix ? args.slice(1) : args) : tracked();
  /** @type {{ file: string, line: number, text: string }[]} */
  let problems = [];
  for (const file of files) {
    if (!kindOf(file)) continue;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    if (fix) {
      const next = strip(file, src);
      if (next !== src) writeFileSync(file, next);
      src = next;
    }
    problems = problems.concat(check(file, src));
  }
  for (const p of problems) console.error(`${p.file}:${p.line} comment: ${p.text}`);
  if (problems.length) console.error(`\n${problems.length} comment(s). Code explains itself; run with --fix to remove them.`);
  process.exit(problems.length ? 1 : 0);
}
