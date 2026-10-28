# TODO

Status on 2026-10-28. Update this file when work lands; delete items that are done.

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


## Roadmap: platform for many developers

Decisions D28 to D37 hold the options. Order:

1. **Foundation:** done. Engine 1.0 with optional capabilities (D28) is built; apps in the apps repository still declare `^0.1`, which engine 1.x accepts, and move to `^1` when they are next released.
2. **Shell UI and UI kit:** the optional UI kit (`/__appshell/ui.css`, D34) is built and the template uses it. Restyling the 11 apps happens in the apps repository. Shell UI: top bar with tabs, tab overflow menu, Home, Store with categories and install confirmation, Settings (General, Apps, Accounts, Network access), account menu and tile menu are built and checked at 800, 1024, 1280 and 1920 wide in light and dark. Still to build: Activity log (needs an audit-read host API), capability diff in the update dialog (needs capabilities in the catalog), app glyph icons, Lock button, command palette, crash and load-failure states.
3. **Launcher:** kiosk lock is built (D35). Still to build: layout editing (pages, folders, dock, widget sizes, wallpaper) as a launcher app.
4. **UI kit and apps:** D34; restyle the 11 apps in appshell-apps.
5. **Developer tools:** D33 and the docs quickstart.
6. **Trust at scale:** D31, D32, revocation list.
7. **Capabilities:** D30 file, print and clipboard; D36 device services; D37 search.
8. **Store:** enable `trustedKeys` once the apps are re-released with signatures; shop network and printer grants.

## Needs the repo owner

- [ ] Decide D29 (when the third capability lands) and D36 (when device services start). All other decisions are decided.
- [ ] Merge the grants and package signing PRs. Generate the signing key, set it as a release secret and sign the apps repository releases (protected workflow change).
- [ ] Sign and merge the release workflow change (`.github/` is protected).

## Next: v0.5.0

Contents: top-bar shell, kiosk mode, engine 1.0 with optional capabilities, UI kit.

- [ ] Main is green after this change; start the candidate build (`gh workflow run release --ref main`) on all three platforms.
- [ ] On the candidate (Windows): install, install a catalog app, run the hostile-app gate against the packaged build, uninstall, check the install and data folders are gone.
- [ ] Tag `v0.5.0` (owner). Release notes state that installers are unsigned (D22 option B).
- [ ] Publish the host release first, then release the apps that need engine 1: the eight restyled apps (0.2.0), `launcher-grid`, `launcher-list` and `resume-builder` 0.2.0.
- [ ] Delete the stale v0.3.0, v0.4.0 and v0.4.1 drafts.
- [ ] Verified sign-in (Google, Microsoft, custom OIDC, GitHub), the second part of D24; it needs client IDs from the owner.

## Phase 1 gate

- [ ] Timed walkthrough: template to installed release in under 15 minutes, using the docs only.

## Later

- [ ] Issue triaging and fixing agent: inspects incoming issues, reproduces bugs with isolated tests, drafts minimal fixes conforming to contracts and hygiene, and verifies gates.
- [ ] Ratings and reviews in the store. Skipped for now; they need a backend the static store does not have.


## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
