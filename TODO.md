# TODO

Status on 2026-10-13. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the Windows installer pipeline.
- **Phase 1 (in pull requests, all tests passing):** catalog installs, the CLI and template, identity tokens, install links from the store, the product page.

## Merge order

The PRs are stacked. Merge each one, deleting its branch, so GitHub retargets the next PR to `main`.

1. appshell #1: install apps from verified catalog releases (D9–D11)
2. appshell #2: developer CLI and app template
3. appshell #3: app-scoped identity tokens (D8)
4. appshell #4: install links from a web store, with confirmation
5. appshell #5: Appshell product page
6. appshell-apps #1: release apps from tags into the catalog
7. appshell-apps #2: app store on GitHub Pages. Merge only after appshell #4, because older hosts reject the new catalog fields.

## Needs the repo owner

- [ ] appshell settings: set the default branch to `main`; delete the `phase-0` and `diag` branches.
- [ ] Pages: in both repos, set Settings > Pages > Source to GitHub Actions. `appshell` is private, so its Pages need a paid GitHub plan.
- [ ] After merging, push tag `welcome-v0.1.0` in appshell-apps to publish the first catalog app.
- [ ] Confirm the D8–D11 decisions, which were marked Decided on the instruction to continue with Phase 1.
- [ ] Decide D12: signing with Sigstore or an internal PKI.

## Next: Phase 1 gate

- [ ] Timed walkthrough: template to installed release in under 15 minutes, using the docs only.
- [ ] Run the hostile-app gate against a packaged build, because hardened builds may drop `NODE_OPTIONS` (see Known risks in `docs/decisions.md`).

## Next: Phase 2 (trust and governance)

- [ ] Show an app's declared capabilities in the install prompt before it goes live (two-step install).
- [ ] Turn on `policy.capabilities: enforce` by default for products.
- [ ] Restrict backend network access; today only the UI is limited to declared hosts.
- [ ] Package signing and publisher identity (D12).
- [ ] Admin policy management, review workflow and audit log.
- [ ] Automatic update checks; updates are user-initiated today.

## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
- The product page's Download button links to this private repo's Releases.
