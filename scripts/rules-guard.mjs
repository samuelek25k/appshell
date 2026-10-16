import { readFileSync } from 'node:fs';

const { GITHUB_TOKEN, REPOSITORY, PULL, OWNER_EMAIL } = process.env;
const api = async (path) => {
  const res = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

const rules = readFileSync('.github/protected-paths', 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const isProtected = (/** @type {string} */ file) => rules.some((r) => (r.endsWith('/') ? file.startsWith(r) : file === r));

const commits = [];
for (let page = 1; ; page++) {
  const batch = await api(`pulls/${PULL}/commits?per_page=100&page=${page}`);
  commits.push(...batch);
  if (batch.length < 100) break;
}

const failures = [];
for (const { sha } of commits) {
  const commit = await api(`commits/${sha}`);
  const touched = commit.files.flatMap((/** @type {any} */ f) => [f.filename, f.previous_filename].filter(Boolean)).filter(isProtected);
  if (!touched.length) continue;
  const { verified } = commit.commit.verification;
  const { email, name } = commit.commit.committer;
  if (!verified || email !== OWNER_EMAIL || name === 'GitHub') {
    failures.push(`${sha.slice(0, 7)} changes ${touched.join(', ')} without a verified signature from ${OWNER_EMAIL}`);
  }
}

for (const f of failures) console.log(`::error title=protected rules::${f}`);
console.log(failures.length ? `${failures.length} commit(s) change protected rules unsigned.` : 'No unsigned changes to protected rules.');
process.exit(failures.length ? 1 : 0);
