# TODO

Status on 2026-10-14. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the multi-platform installer pipeline (Windows `.exe` NSIS, Apple macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`).
- **Phase 1 (on `main`):** catalog installs (D9–D11), developer CLI & template, app-scoped identity tokens (D8), store install links with confirmation, and the Appshell product page.
- **Phase 2 & Hardening (Completed):**
  - **Inter-App Communication (IAC) (D17):** Host-mediated messaging and pub/sub topic broadcasting with declarative permissions, strict isolation, and audit logging.
  - **Theme Settings & Adaptation (D18):** User theme preferences (system, light, dark) exposed via host UI toggle, persisted in settings, propagated to Electron nativeTheme, and exposed to apps via bridge and SDK.
  - **Tenant Branding & Unified Assets (D19):** Single unified asset folder for tenant branding (`products/<tenant>/assets/` and root `assets/`), with dynamic logo and brand color injection into host chrome.
  - **Strict Update Lifecycle, Stale Pruning & Migration (D20):** Automated prune pass unlinks stale .staging/ remnants, untracked app folders, and obsolete versions; web session cache purged on update; uninstaller purges storage and app logs; apps inspect shell.getVersions() for deterministic schema migrations.
  - **Desktop Host UI:** Clean, lightweight desktop layout for installed apps, host-rendered widgets, and catalog management matching contracts.md.
  - **Localization & Internationalization (D15):** Platform locale detection, LTR/RTL text direction, and `shell.getLocale`.
  - **Platform Hardening & Low-Maintenance Architecture:** Fixed backend network preload (UDP, DNS, port stripping), capped audit logs with rotation, built-in Node 22 test coverage (`pnpm test:coverage`), dependency audit (`pnpm audit`), pinned GitHub Actions, and community health assets (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`, Renovate).


## Needs the repo owner

- [x] appshell: default branch set to `main`; `phase-0` branch deleted.
- [ ] Pages: in both repos, set Settings > Pages > Source to GitHub Actions. `appshell` is private, so its Pages need a paid GitHub plan.
- [ ] After merging, push tag `welcome-v0.1.0` in appshell-apps to publish the first catalog app.
- [x] Confirm D8–D16 decisions.

## Next: Phase 1 gate

- [x] Streamline host UI: removed mobile launcher concepts (drawer, gesture pill, dock, glance clock) in favor of a lean, fast desktop layout for apps, widgets, and catalog matching `docs/contracts.md`.
- [ ] Timed walkthrough: template to installed release in under 15 minutes, using the docs only.
- [ ] Run the hostile-app gate against a packaged build, because hardened builds may drop `NODE_OPTIONS` (see Known risks in `docs/decisions.md`).

## Later

- [ ] Ratings and reviews in the store. Skipped for now; they need a backend the static store does not have.

## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
