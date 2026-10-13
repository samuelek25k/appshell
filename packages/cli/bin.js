#!/usr/bin/env node
// appshell: create, run, package and catalogue apps.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validate } from '@appshell/contracts';
import { checkAppDir, pack } from '@appshell/distribution';

const require = createRequire(import.meta.url);
const HOST_DIR = dirname(dirname(require.resolve('@appshell/host')));
const HOST_VERSION = JSON.parse(readFileSync(join(HOST_DIR, 'package.json'), 'utf8')).version;
const TEMPLATE = fileURLToPath(new URL('./template', import.meta.url));

const USAGE = `Usage:
  appshell create <dir> --id <app-id> [--title <title>] [--publisher <name>]
  appshell dev <app-dir>
  appshell package <app-dir> [--out <dir>] [--ext <.ext>]
  appshell catalog add <index.json> --app <app-dir> --repository <url> --url <release-url> --sha256 <hex> --commit <sha> [--channel stable|beta]`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest, allowPositionals: true,
  options: {
    id: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' },
    out: { type: 'string' }, ext: { type: 'string', default: '.tgz' },
    app: { type: 'string' }, repository: { type: 'string' }, url: { type: 'string' },
    sha256: { type: 'string' }, commit: { type: 'string' }, channel: { type: 'string', default: 'stable' },
  },
});

/** @param {string} message */
const die = (message) => { console.error(message); process.exit(1); };

/** Replaces __ID__, __TITLE__ and __PUBLISHER__ in every template file. @param {string} dir @param {Record<string, string>} vars */
function fill(dir, vars) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) { fill(file, vars); continue; }
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`__${k}__`, v), text));
  }
}

const commands = {
  create() {
    const [dir] = positionals;
    if (!dir || !values.id) die(USAGE);
    if (existsSync(dir)) die(`${dir} already exists`);
    const id = /** @type {string} */ (values.id);
    cpSync(TEMPLATE, dir, { recursive: true });
    cpSync(require.resolve('@appshell/sdk/backend'), join(dir, 'backend', 'appshell-backend.cjs'));
    fill(dir, { ID: id, TITLE: values.title ?? id, PUBLISHER: values.publisher ?? 'Unknown publisher' });
    const result = validate('manifest', JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
    if (!result.ok) die(`Invalid app: ${result.errors.join('; ')}`);
    console.log(`Created ${id} in ${dir}. Run: appshell dev ${dir}`);
  },

  dev() {
    const [dir] = positionals;
    if (!dir) die(USAGE);
    const app = resolve(dir);
    checkAppDir(app, HOST_VERSION);
    const work = mkdtempSync(join(tmpdir(), 'appshell-dev-'));
    const product = join(work, 'product.json');
    writeFileSync(product, JSON.stringify({
      name: 'Appshell Dev', protocol: 'appshelldev', dataDirectory: 'appshell-dev',
      package: { extension: '.tgz', displayName: 'App package' },
      apps: [{ path: app }], policy: { capabilities: 'enforce', developerMode: true },
    }));
    const { id } = JSON.parse(readFileSync(join(app, 'manifest.json'), 'utf8'));
    const electron = /** @type {string} */ (require('electron'));
    spawn(electron, [HOST_DIR, '--product', product, '--user-data', join(work, 'data'), `appshelldev://${id}/`], { stdio: 'inherit' })
      .on('exit', (code) => process.exit(code ?? 0));
  },

  async package() {
    const [dir] = positionals;
    if (!dir) die(USAGE);
    const { manifest } = checkAppDir(dir, HOST_VERSION);
    const file = join(resolve(values.out ?? '.'), `${manifest.id}-${manifest.version}${values.ext}`);
    const { sha256 } = await pack(dir, file, HOST_VERSION);
    console.log(JSON.stringify({ id: manifest.id, version: manifest.version, file, sha256 }, null, 2));
  },

  catalog() {
    const [action, indexFile] = positionals;
    const { app, repository, url, sha256, commit, channel } = values;
    if (action !== 'add' || !indexFile || !app || !repository || !url || !sha256 || !commit) die(USAGE);
    const { manifest } = checkAppDir(/** @type {string} */ (app), HOST_VERSION);
    const catalog = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { format: 1, apps: [] };
    let entry = catalog.apps.find((/** @type {{ id: string }} */ e) => e.id === manifest.id);
    if (!entry) catalog.apps.push(entry = { id: manifest.id, title: '', publisher: '', repository: '', releases: [] });
    Object.assign(entry, { title: manifest.title, publisher: manifest.publisher, repository });
    entry.releases = entry.releases.filter((/** @type {{ version: string }} */ r) => r.version !== manifest.version);
    entry.releases.push({ version: manifest.version, channel, url, sha256, commit });
    const result = validate('catalog', catalog);
    if (!result.ok) die(`Invalid catalog: ${result.errors.join('; ')}`);
    writeFileSync(indexFile, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`${basename(indexFile)}: ${manifest.id}@${manifest.version} (${channel})`);
  },
};

const run = Object.hasOwn(commands, command ?? '') ? commands[/** @type {keyof typeof commands} */ (command)] : undefined;
if (!run) die(USAGE);
await /** @type {Function} */ (run)();
