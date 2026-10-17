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
  const htmlFile = resolve(cwd, 'site/releases.html');

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

  const latest = publicReleases[0];
  const tag = latest.tag_name;
  if (!tag) return;

  let html = readFileSync(htmlFile, 'utf8');

  html = html.replace(
    /<span id="latest-badge-text"[^>]*>[^<]*<\/span>/,
    `<span id="latest-badge-text">${tag} · Latest Release</span>`
  );

  html = html.replace(
    /<h2 id="release-notes-title"[^>]*>[^<]*<\/h2>/,
    `<h2 id="release-notes-title" class="text-2xl font-extrabold text-slate-900 dark:text-white">What's New in ${tag}</h2>`
  );

  const assets = latest.assets || [];
  const winAsset = assets.find((/** @type {any} */ a) => a.name.endsWith('.exe'));
  const macArmAsset = assets.find((/** @type {any} */ a) => a.name.endsWith('.dmg') && (a.name.includes('arm64') || a.name.includes('arm')));
  const macIntelAsset = assets.find((/** @type {any} */ a) => a.name.endsWith('.dmg') && (a.name.includes('x64') || a.name.includes('intel')));
  const macDmgAsset = macArmAsset || macIntelAsset || assets.find((/** @type {any} */ a) => a.name.endsWith('.dmg'));

  if (winAsset) {
    html = html.replace(
      /id="hero-win-btn"\s+href="[^"]*"/,
      `id="hero-win-btn" href="${winAsset.browser_download_url}"`
    );
    html = html.replace(
      /id="card-win-link"\s+href="[^"]*"/,
      `id="card-win-link" href="${winAsset.browser_download_url}"`
    );
  }

  if (macDmgAsset) {
    html = html.replace(
      /id="hero-mac-btn"\s+href="[^"]*"/,
      `id="hero-mac-btn" href="${macDmgAsset.browser_download_url}"`
    );
  }

  if (macArmAsset) {
    html = html.replace(
      /id="card-mac-arm-link"\s+href="[^"]*"/,
      `id="card-mac-arm-link" href="${macArmAsset.browser_download_url}"`
    );
  }

  if (macIntelAsset) {
    html = html.replace(
      /id="card-mac-intel-link"\s+href="[^"]*"/,
      `id="card-mac-intel-link" href="${macIntelAsset.browser_download_url}"`
    );
  }

  writeFileSync(htmlFile, html, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  buildReleases().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
