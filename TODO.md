# TODO

Status on 2026-10-16. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the multi-platform installer pipeline (Windows `.exe` NSIS, Apple macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`).
- **Phase 1 (on `main`):** catalog installs (D9–D11), developer CLI & template, app-scoped identity tokens (D8), store install links with confirmation, and the Appshell product page.
- **Phase 2 & Hardening (Completed):**
  - **Inter-App Communication (IAC) (D17):** Host-mediated messaging and pub/sub topic broadcasting with declarative permissions, strict isolation, and audit logging.
  - **Theme Settings & Adaptation (D18):** User theme preferences (system, light, dark) exposed via host UI toggle, persisted in settings, propagated to Electron nativeTheme, and exposed to apps via bridge and SDK.
  - **Tenant Branding & Unified Assets (D19):** Single unified asset folder for tenant branding (`products/<tenant>/assets/`), with dynamic logo and brand color injection into host chrome.
  - **Strict Update Lifecycle, Stale Pruning & Migration (D20):** Automated prune pass unlinks stale .staging/ remnants, untracked app folders, and obsolete versions; web session cache purged on update; uninstaller purges storage and app logs; apps inspect shell.getVersions() for deterministic schema migrations.
  - **Desktop Host UI:** Clean, lightweight desktop layout for installed apps, host-rendered widgets, and catalog management matching contracts.md.
  - **Localization & Internationalization (D15):** Platform locale detection, LTR/RTL text direction, and `shell.getLocale`.
  - **Accounts, launchers and user-approved addresses (D24, D25, D26):** several local accounts and a Guest with per-account app data, home-screen launcher apps (Grid Home, Search Home) that can also set theme colours, and addresses the user approves per app, such as a local model server.
  - **Platform Hardening & Low-Maintenance Architecture:** Fixed backend network preload (UDP, DNS, port stripping), capped audit logs with rotation, built-in Node 22 test coverage (`pnpm test:coverage`), dependency audit (`pnpm audit`), pinned GitHub Actions, and community health assets (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`, Renovate).


## Needs the repo owner

- [ ] Decide D12 (app package signing), D22 (installer signing) and D23 (product and engine versions).
- [ ] Sign and merge the release workflow change (`.github/` is protected).

## Next: v0.4.0

- [x] Run the release workflow by hand for a release candidate on all three platforms.
- [ ] On the candidate: run the hostile-app gate against the packaged build, install a catalog app, uninstall and check nothing is left behind.
- [ ] Release the apps that need this host: `launcher-grid`, `launcher-list`, `resume-builder` 0.2.0.
- [x] Tag `v0.4.0`. Release notes state that installers are unsigned until D22.
- [ ] Verified sign-in (Google, Microsoft, custom OIDC, GitHub), the second part of D24; it needs client IDs from the owner.

## Phase 1 gate

- [ ] Timed walkthrough: template to installed release in under 15 minutes, using the docs only.

## Later

- [ ] Issue triaging and fixing agent: inspects incoming issues, reproduces bugs with isolated tests, drafts minimal fixes conforming to contracts and hygiene, and verifies gates.
- [ ] Ratings and reviews in the store. Skipped for now; they need a backend the static store does not have.


## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
