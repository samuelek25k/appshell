import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getGitHubToken() {
  try {
    const creds = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const match = creds.match(/^password=(.*)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} [cwd]
 * @returns {Promise<void>}
 */
export async function buildReleases(cwd = process.cwd()) {
  const token = process.env.GITHUB_TOKEN || getGitHubToken();
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'appshell-site-build',
    ...(token ? { Authorization: `token ${token}` } : {}),
  };

  const releasesFile = resolve(cwd, 'site/releases.json');

  let releases = [];
  try {
    const res = await fetch('https://api.github.com/repos/samuelek25k/appshell/releases?per_page=10', { headers });
    if (res.ok) {
      releases = await res.json();
    }
  } catch {}

  if (!Array.isArray(releases) || releases.length === 0) {
    try {
      releases = JSON.parse(readFileSync(releasesFile, 'utf8'));
    } catch {
      return;
    }
  }

  const publicReleases = releases.filter((/** @type {any} */ r) => !r.draft);
  if (publicReleases.length === 0) return;

  writeFileSync(releasesFile, JSON.stringify(publicReleases, null, 2) + '\n', 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  buildReleases().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
