// Writes electron-builder config for one product, so names, protocol and package
// extension come from product.json instead of framework code.
// Usage: node scripts/build-config.mjs products/<name>/product.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const productFile = resolve(process.argv[2] ?? 'products/appshell/product.json');
const product = JSON.parse(readFileSync(productFile, 'utf8'));
const productDir = relative(process.cwd(), dirname(productFile));

const config = {
  appId: `dev.appshell.${product.dataDirectory}`,
  productName: product.name,
  directories: { app: 'packages/host', output: 'dist' },
  extraMetadata: { name: product.dataDirectory },
  extraResources: [{ from: productDir, to: 'product', filter: ['**/*', '!**/.git{,/**}'] }],
  protocols: [{ name: product.name, schemes: [product.protocol] }],
  fileAssociations: [{ ext: product.package.extension.slice(1), name: product.package.displayName }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  mac: { target: ['dmg'] },
  linux: { target: ['AppImage'] },
};

writeFileSync('electron-builder.json', JSON.stringify(config, null, 2) + '\n');
console.log(`electron-builder.json written for ${product.name}`);
