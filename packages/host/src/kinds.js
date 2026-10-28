export const KINDS = /** @type {const} */ ({
  app: { openable: true, home: false },
  launcher: { openable: false, home: true },
});

/** @param {import('./registry.js').InstalledApp['manifest']} manifest */
export const kindOf = (manifest) => manifest.kind ?? 'app';

/** @param {import('./registry.js').InstalledApp['manifest']} manifest */
export const isOpenable = (manifest) => KINDS[kindOf(manifest)].openable;

/** @param {import('./registry.js').InstalledApp['manifest']} manifest */
export const isHome = (manifest) => KINDS[kindOf(manifest)].home;
