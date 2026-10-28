import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} productDir
 * @param {string[]} names
 */
function findAsset(productDir, names) {
  const places = [
    join(productDir, 'assets'),
    productDir,
    join(process.resourcesPath, 'product', 'assets'),
    join(process.resourcesPath, 'product'),
  ];
  return places.flatMap((place) => names.map((name) => join(place, name))).find((p) => existsSync(p));
}

/** @param {string} productDir */
export function loadBranding(productDir) {
  /** @type {string | null} */
  let logo = null;
  /** @type {Record<string, string>} */
  let colors = {};
  const mark = findAsset(productDir, ['mark.svg']);
  if (mark) {
    try {
      logo = `data:image/svg+xml;utf8,${encodeURIComponent(readFileSync(mark, 'utf8'))}`;
    } catch {}
  }
  const brand = findAsset(productDir, ['brand.json']);
  if (brand) {
    try {
      colors = JSON.parse(readFileSync(brand, 'utf8'));
    } catch {}
  }
  return { logo, colors, icon: findAsset(productDir, ['icon.png', 'icon.ico']) };
}
