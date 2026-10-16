# TODO

Status on 2026-10-14. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the Windows installer pipeline.
- **Phase 1 (on `main`):** catalog installs (D9–D11), developer CLI & template, app-scoped identity tokens (D8), store install links with confirmation, and the Appshell product page.
- **Phase 2 & Desktop Home Screen Experience (Completed):**
  - **Android Home Screen Experience (D13):** At-a-Glance smart header (live clock, date, status), slide-up App Drawer with category filters and search, dynamic wallpaper engines (Obsidian, Aurora, Cyber, Violet, Sunset), adaptive icon shapes (Squircle, Circle, Rounded, Teardrop), grid density controls (4x4, 5x5, 3x4), and third-party launcher selection with emergency fallback `CommandOrControl+Shift+Escape`.
  - **Multi-Account & Identity Claims (D14):** Native multi-account management (Google, Microsoft, Local), active account claims in scoped Ed25519 tokens.
  - **Localization & Internationalization (D15):** Platform locale detection, LTR/RTL text direction, `shell.getLocale` and `shell.localeChanged`.
  - **Secure Storage at Rest (D16):** Authenticated AES-256-GCM encryption for apps with `capabilities.secureStorage`, per-app HKDF key derivation, zero plaintext on disk.
  - **Platform Design Tokens:** Standard `--appshell-*` tokens served at `/__appshell/tokens.css`.
  - **Trust & Governance:** Backend network enforcement, `policy.blockedApps`, `logs/audit.log`, periodic catalog update checks.

## Next steps

1. appshell-apps #4: rich store, Quick Notes and World Clock. Publish catalog releases from appshell-apps.

## Needs the repo owner

- [x] appshell: default branch set to `main`; `phase-0` branch deleted.
- [ ] Pages: in both repos, set Settings > Pages > Source to GitHub Actions. `appshell` is private, so its Pages need a paid GitHub plan.
- [ ] After merging, push tag `welcome-v0.1.0` in appshell-apps to publish the first catalog app.
- [x] Confirm D8–D16 decisions.

## Next: Phase 1 gate

- [ ] Timed walkthrough: template to installed release in under 15 minutes, using the docs only.
- [ ] Run the hostile-app gate against a packaged build, because hardened builds may drop `NODE_OPTIONS` (see Known risks in `docs/decisions.md`).

## Later

- [ ] Ratings and reviews in the store. Skipped for now; they need a backend the static store does not have.

## Known limitations

- Widgets appear only after their app has run in the current session.
- The shell's catalog list shows descriptions but not icons or screenshots, because its CSP blocks remote images.
