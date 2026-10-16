import { createStore, latestRelease, parseCatalog, readUrl } from '@appshell/distribution';

/**
 * @param {{
 *   policy: import('./registry.js').Product['policy'],
 *   catalogUrl: string | undefined,
 *   root: string,
 *   hostVersion: string,
 *   fetch: typeof globalThis.fetch,
 * }} options
 */
export function createManager({ policy, catalogUrl, root, hostVersion, fetch }) {
  const store = createStore(root);
  const channel = policy.channel ?? 'stable';
  /** @type {import('@appshell/distribution').CatalogEntry[]} */
  let catalog = [];
  /** @type {string | null} */
  let catalogError = null;

  /** @param {string} id */
  const entryFor = (id) => {
    const entry = catalog.find((e) => e.id === id);
    if (!entry) throw new Error(`${id} is not in the catalog`);
    const release = latestRelease(entry, channel);
    if (!release) throw new Error(`${id} has no ${channel} release`);
    return { entry, release };
  };

  return {
    installed: () => store.list(),

    async refresh() {
      if (!catalogUrl) return;
      try {
        catalog = parseCatalog(new TextDecoder().decode(await readUrl(catalogUrl, fetch)));
        catalogError = null;
      } catch (error) {
        catalogError = error instanceof Error ? error.message : String(error);
      }
    },

    rows() {
      const installed = new Map(store.list().map((s) => [s.current.id, s]));
      const rows = catalog.map((entry) => {
        const s = installed.get(entry.id);
        return {
          id: entry.id, title: entry.title, publisher: entry.publisher, description: entry.description ?? '', repository: entry.repository,
          latest: latestRelease(entry, channel)?.version ?? null,
          installed: s?.current.version ?? null, previous: s?.previous?.version ?? null,
        };
      });
      for (const [id, s] of installed) {
        if (!catalog.some((e) => e.id === id)) rows.push({ id, title: id, publisher: s.current.repository, description: '', repository: s.current.repository, latest: null, installed: s.current.version, previous: s.previous?.version ?? null });
      }
      return { rows, error: catalogError, enabled: Boolean(catalogUrl) };
    },

    /** @param {string} id */
    install(id) {
      const { entry, release } = entryFor(id);
      return store.install(entry, release, { hostVersion, policy, fetch });
    },
    rollback: (/** @type {string} */ id) => store.rollback(id),
    uninstall: (/** @type {string} */ id) => store.uninstall(id),
    provenance: (/** @type {string} */ id) => store.list().find((s) => s.current.id === id),
    prune: () => store.prune(),
  };
}
