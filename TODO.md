# TODO

Status on 2026-10-14. Update this file when work lands; delete items that are done.

## Where things stand

- **Phase 0 (on `main`):** the platform contract, the isolated app runtime, the bridge, the shell, the SDK, the hostile-app gate on Windows, macOS and Linux, and the Windows installer pipeline.
- **Phase 1 (on `main`):** catalog installs (D9–D11), developer CLI & template, app-scoped identity tokens (D8), store install links with confirmation, and the Appshell product page.
- **Phase 2 & Hardening (Completed):**
  - **Inter-App Communication (IAC) (D17):** Host-mediated messaging and pub/sub topic broadcasting with declarative permissions, strict isolation, and audit logging.
  - **Android-Inspired Home Screen Experience:** Clean, responsive At-a-Glance smart header, app drawer with categories and search, adaptive icon squircle styling with zero CSP violations.
  - **Localization & Internationalization (D15):** Platform locale detection, LTR/RTL text direction, and `shell.getLocale`.
  - **Platform Hardening & Low-Maintenance Architecture:** Fixed backend network preload (UDP, DNS, port stripping), capped audit logs with rotation, built-in Node 22 test coverage (`pnpm test:coverage`), dependency audit (`pnpm audit`), pinned GitHub Actions, and community health assets (`LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`, Renovate).


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
