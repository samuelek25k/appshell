import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} productPath
 * @param {string} [cwd]
 * @returns {Record<string, unknown>}
 */
export function generateBuildConfig(productPath, cwd = process.cwd()) {
  const productFile = resolve(cwd, productPath);
  const product = JSON.parse(readFileSync(productFile, 'utf8'));
  const productDir = relative(cwd, dirname(productFile)).replaceAll('\\', '/');

  const iconCandidates = [
    resolve(dirname(productFile), 'assets', 'icon.png'),
    resolve(dirname(productFile), 'assets', 'icon.ico'),
    resolve(dirname(productFile), 'icon.png'),
    resolve(dirname(productFile), 'icon.ico'),
    resolve(cwd, 'site/icon-512.png'),
  ];
  const iconPath = iconCandidates.find((p) => existsSync(p));
  const relIcon = iconPath ? relative(cwd, iconPath).replaceAll('\\', '/') : undefined;

  const icoCandidates = [
    resolve(dirname(productFile), 'assets', 'icon.ico'),
    resolve(dirname(productFile), 'icon.ico'),
  ];
  const icoPath = icoCandidates.find((p) => existsSync(p));
  const relIco = icoPath ? relative(cwd, icoPath).replaceAll('\\', '/') : undefined;

  return {
    appId: `dev.appshell.${product.dataDirectory}`,
    productName: product.name,
    directories: { app: 'packages/host', output: 'dist' },
    extraMetadata: { name: product.dataDirectory },
    extraResources: [{
      from: productDir,
      to: 'product',
      filter: ['product.json', 'assets{,/**}', ...(product.apps || []).flatMap((/** @type {any} */ a) => [`apps/${a.path}{,/**}`, `${a.path}{,/**}`])],
    }],
    electronFuses: {
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: true,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    protocols: [{ name: product.name, schemes: [product.protocol] }],
    ...(relIcon ? { icon: relIcon } : {}),
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      ...(relIcon ? { icon: relIcon } : {}),
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      artifactName: '${productName}-Setup.${ext}',
      ...(relIco ? { installerIcon: relIco, uninstallerIcon: relIco } : {}),
    },
    mac: {
      target: [
        { target: 'dmg', arch: ['x64', 'arm64'] },
        { target: 'zip', arch: ['x64', 'arm64'] },
      ],
      category: 'public.app-category.developer-tools',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      ...(relIcon ? { icon: relIcon } : {}),
    },
    dmg: {
      artifactName: '${productName}-${arch}.${ext}',
      contents: [
        { x: 130, y: 220 },
        { x: 410, y: 220, type: 'link', path: '/Applications' },
      ],
    },
    appImage: { artifactName: '${productName}.${ext}' },
    linux: {
      ...(product.maintainer ? { maintainer: product.maintainer } : {}),
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      category: 'Utility',
      ...(relIcon ? { icon: relIcon } : {}),
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const productFile = process.argv[2] ?? 'products/appshell/product.json';
  const outFile = process.argv[3] ?? 'electron-builder.json';
  const config = generateBuildConfig(productFile);
  writeFileSync(outFile, JSON.stringify(config, null, 2) + '\n');
  console.log(`${outFile} written for ${config.productName}`);
}
