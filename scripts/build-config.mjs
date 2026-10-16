import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const productFile = resolve(process.argv[2] ?? 'products/appshell/product.json');
const product = JSON.parse(readFileSync(productFile, 'utf8'));
const productDir = relative(process.cwd(), dirname(productFile));

const iconCandidates = [
  resolve(dirname(productFile), 'icon.png'),
  resolve(dirname(productFile), 'icon.ico'),
  resolve('site/icon-512.png'),
];
const iconPath = iconCandidates.find((p) => existsSync(p));
const relIcon = iconPath ? relative(process.cwd(), iconPath) : undefined;

const config = {
  appId: `dev.appshell.${product.dataDirectory}`,
  productName: product.name,
  directories: { app: 'packages/host', output: 'dist' },
  extraMetadata: { name: product.dataDirectory },
  extraResources: [{ from: productDir, to: 'product', filter: ['**/*', '!**/.git{,/**}'] }],
  protocols: [{ name: product.name, schemes: [product.protocol] }],
  fileAssociations: [{ ext: product.package.extension.slice(1), name: product.package.displayName }],
  ...(relIcon ? { icon: relIcon } : {}),
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...(relIcon ? { icon: relIcon } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    ...(relIcon ? { installerIcon: relIcon, uninstallerIcon: relIcon } : {}),
  },
  mac: {
    target: ['dmg'],
    ...(relIcon ? { icon: relIcon } : {}),
  },
  linux: {
    target: ['AppImage'],
    ...(relIcon ? { icon: relIcon } : {}),
  },
};

writeFileSync('electron-builder.json', JSON.stringify(config, null, 2) + '\n');
console.log(`electron-builder.json written for ${product.name}`);
