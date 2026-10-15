# TODO

Status on 2026-10-14. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the Windows installer pipeline.
- **Phase 1 (on `main`):** catalog installs (D9–D11), developer CLI & template, app-scoped identity tokens (D8), store install links with confirmation, and the Appshell product page.

## Next steps

1. appshell-apps #4: rich store, Quick Notes and World Clock. Publish catalog releases from appshell-apps.

## Needs the repo owner

- [x] appshell: default branch set to `main`; `phase-0` branch deleted.
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

## Later

- [ ] Multiple sign-in methods as a platform feature: each product (tenant) chooses its providers, such as OIDC, SAML or a local account, in `product.json`, and apps keep using identity tokens. Needs a decision before work starts.
- [ ] Ratings and reviews in the store. Skipped for now; they need a backend the static store does not have.
- [ ] **Custom Launcher App & Shell Screen Customization (D13 concept):**
  - Allow specialized apps to act as the desktop shell's home screen / launcher surface (`role: "launcher"`).
  - Enable customizable shell screens: layout grids, custom app organization, docking trays, quick-launch command palettes, wallpapers, and accent theming.
  - Controlled bridge APIs: `shell.listInstalledApps()` (title, icon, categories, id), `shell.launchApp(id)`, `shell.getWidgets()`, and `shell.setDashboardPreferences(prefs)`.
  - Security invariant: Launcher apps run in standard isolated `WebContentsView` sandboxes on origin `app://<id>/` with zero Node access and zero host IPC exposure.
  - Reliability invariant: The host provides a guaranteed fallback hotkey/toggle (e.g. `Ctrl/Cmd + Shift + Esc`) to restore the default shell dashboard at any time.

## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
