import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const hostPkg = JSON.parse(readFileSync(join(root, 'packages/host/package.json'), 'utf8'));
const version = hostPkg.version;
const engine = hostPkg.appshell?.engine;

const sha = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();

console.log(`Version: ${version} (engine: ${engine})`);
console.log(`Commit:  ${sha}`);
console.log(`Tree:    ${status ? 'DIRTY' : 'clean'}`);

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

const token = process.env.GITHUB_TOKEN || getGitHubToken();
if (!token) {
  console.log('No GitHub token available to query workflow runs.');
  process.exit(0);
}

const headers = {
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'appshell-release-check',
};

async function check() {
  const runsRes = await fetch('https://api.github.com/repos/samuelek25k/appshell/actions/runs?per_page=5', { headers });
  if (!runsRes.ok) {
    console.log(`GitHub API error: ${runsRes.status} ${runsRes.statusText}`);
    return;
  }
  const runs = (await runsRes.json()).workflow_runs || [];
  const ciRun = runs.find((r) => r.name === 'ci' && r.head_sha === sha);
  const releaseRun = runs.find((r) => r.name === 'release' && r.head_sha === sha);

  if (ciRun) {
    console.log(`CI Run:      #${ciRun.id} [${ciRun.status}] conclusion: ${ciRun.conclusion}`);
  }
  if (releaseRun) {
    console.log(`Release Run: #${releaseRun.id} [${releaseRun.status}] conclusion: ${releaseRun.conclusion}`);
    const jobsRes = await fetch(`https://api.github.com/repos/samuelek25k/appshell/actions/runs/${releaseRun.id}/jobs`, { headers });
    if (jobsRes.ok) {
      const { jobs } = await jobsRes.json();
      for (const job of jobs) {
        console.log(`  - ${job.name}: ${job.status} (${job.conclusion ?? 'in progress'})`);
      }
    }
  }

  console.log('\nTag command for repository owner:');
  console.log(`  git tag -a v${version} ${sha} -m "Appshell ${version}"`);
  console.log(`  git push origin v${version}`);
}

check().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
