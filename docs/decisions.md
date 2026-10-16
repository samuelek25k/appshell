# Decision register

Every architecture, tooling and dependency choice is recorded here. Agents add entries as **Pending** with options and a recommendation; only the product owner marks one **Decided**.

| # | Decision | Status | Choice and reason |
| --- | --- | --- | --- |
| D1 | UI isolation | Decided 2026-10-13 | Each app runs in its own sandboxed `WebContentsView` on origin `app://<id>/` with session partition `persist:app:<id>`. The protocol handler of a partition serves only its own app, so cross-app fetches fail. |
| D2 | Widget model | Decided 2026-10-13 | Apps send JSON descriptors (`widget.schema.json`); the host renders them. No app code runs on the dashboard. |
| D3 | Shell protocol | Decided 2026-10-13 | Versioned messages over the bridge: hello with nonce, back, close with veto timeout, deep links. See `docs/contracts.md`. |
| D4 | Backend runtime | Decided 2026-10-13 | One `utilityProcess` per app, started on first call, stopped when idle, restarted on crash (max 3). Node permission model restricts filesystem reads to the app folder and blocks `child_process` and workers; the working directory is set to the app folder because the permission model also grants it read access. Host environment is not inherited. Outbound network requests (TCP, UDP, fetch, and all DNS resolution methods) to undeclared hosts are blocked by a JavaScript-level preload guard, not an OS sandbox. |
| D5 | Host–app bridge | Decided 2026-10-13 | One `appshell.call(method, params)` entry point. The host identifies the caller by its `webContents`, never by a claim in the message, and checks the manifest capability for each call (`policy.capabilities`: `warn` or `enforce`). |
| D6 | Product configuration | Decided 2026-10-13 | One `product.json` per product, validated by `product.schema.json`. JSON instead of YAML so validation needs no parser dependency. |
| D7 | Engineering harness | Decided 2026-10-13 | `AGENTS.md`, this register, secretlint in a husky pre-commit hook and CI, no-comments and commit-message hygiene checks (`scripts/hygiene.mjs`), rules-guard with signed protected paths, type check, tests, hostile app e2e. AI review advisory only. |
| D8 | Identity handoff | Decided 2026-10-13 | The host signs 5-minute Ed25519 JWTs with `aud: app:<id>` for apps that declare `capabilities.identity`; apps and their services verify with the host's public JWK. The key never leaves the host. `sub` is a per-installation id until SSO arrives. Node crypto, no dependency. |
| D9 | Install artifact | Decided 2026-10-13 | Gzipped tar of regular files only, built by CI, pinned in the catalog by SHA-256 and commit. The host verifies the digest, refuses links and paths outside the package, and checks the manifest id and version against the catalog. `file://` packages only in developer mode. |
| D10 | Discovery and providers | Decided 2026-10-13 | One catalog `index.json` per product (`catalog.schema.json`), from the product config. Repository and release URLs must match `policy.allowedSources`. No provider adapters: any HTTPS release URL works. |
| D11 | Versioning and updates | Decided 2026-10-13 | Semver releases on `stable` or `beta`; the product's `policy.channel` picks what users see. Current and previous versions stay on disk, so rollback needs no download. Checks the catalog hourly; installs only when the user acts. |
| D12 | Signing | Pending | Option A: Ed25519 detached signatures (`.sig`) generated during release and verified using Node `crypto.verify()` against keys in `policy.trustedKeys` or catalog metadata. Not yet implemented in code; catalog SHA-256 digests enforce integrity until package signing lands. |
| D13 | Launcher app & shell screen customization | Cut 2026-10-16 | Dropped self-granted `launcher` capability and `CommandOrControl+Shift+Escape` shortcut per adversarial isolation and minimal liability principles. |
| D14 | Multi-account identity management | Cut 2026-10-16 | Dropped user-typed multi-accounts with unverified claims (email, role). Retained D8 single local identity with installation-scoped subject until verified SSO provider is designed. |
| D15 | Localization & internationalization | Decided 2026-10-15 | Exposes `shell.getLocale` with direction (RTL/LTR), locale, and timezone. Aligned `defaultLocale` with product schema. |
| D16 | Secure storage at rest | Cut 2026-10-16 | Dropped application-layer pseudo-encryption on disk; honest guarantee principle forbids claiming encryption when keys reside alongside data without hardware TPM/OS keychain backing. |
| D17 | Inter-app communication (IAC) | Decided 2026-10-16 | Host-mediated messaging and pub/sub topic broadcasting. Apps never communicate directly or access each other's origins/DOM. Both sender and receiver declare permissions via `capabilities.iac` (boolean or scoped by send/receive/channels). Host injects verified sender identity; blockedApps and unauthorized calls are rejected and audited. `launchIfNeeded` is bilateral (sender declares target and receiver explicitly lists sender in `receive`), launching the target window solely to deliver authorized messages, distinct from D13's cut unmediated app launcher. Zero new dependencies. |
| D18 | Theme settings and adaptation | Decided 2026-10-16 | User theme preference (`system`, `light`, `dark`) persisted in settings and applied to Electron `nativeTheme.themeSource`. Propagates `prefers-color-scheme` to all views and exposes `shell.getTheme` and `shell.themeChanged` to apps over the bridge. Zero new dependencies. |
| D19 | Tenant branding and unified assets | Decided 2026-10-16 | All tenant branding assets (`icon.png`, `mark.svg`, `brand.json`) live in `products/<tenant>/assets/`. Host dynamically loads mark SVG and brand color tokens into the chrome state. Core `packages/` contains no tenant-specific assets. |
| D20 | Strict update lifecycle, stale pruning & migration contract | Decided 2026-10-16 | Automated prune pass on startup and lifecycle events deletes stale .staging/ remnants, untracked app directories, and versions older than current and previous. Web session partition cache is flushed on update. Uninstallation unlinks app storage, session data, and app logs. Bridge exposes shell.getVersions so apps deterministically migrate storage schemas and prune deprecated keys. |
| D21 | Host-mediated partitioned browser automation | Cut 2026-10-16 | Cut per Principle 1 (adversarial isolation) and Principle 2 (minimum liability). Embedded browser views allowed untrusted apps to bypass network allowlists via DOM evaluate/fetch, allowed-domain redirects leaked, user consent was absent, and test shims resided in production code. |
| D22 | Installer signing and notarisation | Pending | Windows Authenticode signing and Apple macOS hardened runtime notarisation for distributable installer binaries. Separate from app package signing (D12); requires code-signing certificates and CI release secrets. |
| D23 | Product version separate from engine version | Pending | Recommendation: the installer carries the product version (`version` in `packages/host/package.json`, set per release); apps target the engine version (`appshell.engine`), which changes only with the app contract, so a product release never strands installed apps. |
| D24 | Accounts and sign-in | Decided 2026-10-16 | Three kinds of account. **Local**: created in the shell with a display name and an optional PIN or password (salted scrypt hash, Node crypto); several allowed; the first run offers one named after the OS user; no email or other claims. The PIN only gates opening the account in the shell and does not encrypt data. **Guest**: no identity, temporary storage, secrets and logs wiped on leaving or quitting and swept on the next start; cannot install or remove apps; products may disable it. **Verified**: Google, Microsoft Entra and custom OIDC issuers listed in `product.json` through OpenID Connect (authorization code with PKCE, system browser, redirect to the product's `appshell://` link, public clients, ID tokens checked against the issuer's keys, refresh tokens in Electron `safeStorage`); GitHub through OAuth device flow, with identity from its user API. A local account can be linked to a verified one and keeps its data. Account id is `local:<uuid>`, `guest:<uuid>` or `<issuer>\|<subject>`. Installed apps are shared; storage, secrets and logs are per account; switching stops running apps; removing an account deletes its data. `identity.token` carries `sub` as the account id, `type` (`local`, `guest` or `verified`) and `name`, plus `email` only when verified, and only for apps declaring `capabilities.identity`. Policy may restrict account types, providers and email domains. Apple is not included: it needs a client secret signed with a private key that a desktop app cannot hold. Product owner supplies each provider's client ID. Replaces the cut D14. |
| D25 | Launcher apps replace the home screen | Decided | Recommendation: an app with `kind: "launcher"` renders in the home area in place of the built-in dashboard and can also set the theme; it uses the normal bridge plus a declared `launcher` capability (list and open installed apps, read widgets, set theme tokens within the schema), nothing more. The built-in dashboard is the fallback when a launcher fails to load. The platform ships two launchers (grid, search-first list); more install from the catalog like any app. Active launcher and theme are chosen per account in Settings. |


## Dependencies

| Package | Why | Status |
| --- | --- | --- |
| `electron` | The runtime. | Decided (D1) |
| `ajv` | JSON Schema validation for manifests, product config and widgets; the schemas are the contract. | Decided (D5, D6) |
| `typescript` (dev) | Type checks JSDoc-annotated JavaScript with `checkJs`; no build step. | Decided (D7) |
| `tar` | Reads and writes app packages; maintained by the npm team, used by npm itself. Node has no built-in tar. | Decided (D9) |
| `electron-builder` (dev) | Builds installers across Windows (`.exe` NSIS), Apple macOS (`.dmg`, `.zip`) and Linux (`.AppImage`, `.deb`). Installer signing pending D22. | Decided |
| `secretlint`, `@secretlint/secretlint-rule-preset-recommend`, `husky` (dev) | Secret scanning before commit and in CI. | Decided (D7) |

## Known risks

- **Backend permission flags travel through `NODE_OPTIONS`.** `utilityProcess` ignores `execArgv` permission flags. Hardened packaged builds that disable the `NODE_OPTIONS` fuse may drop them; run the hostile app against a packaged build before Phase 3 closes.
- **Local runs as root need `--no-sandbox`.** That disables Chromium's OS sandbox, not the per-view `sandbox` preference. CI runs unprivileged with the OS sandbox on.

## Constraints the code relies on

The code carries no comments, so non-obvious reasons live here.

- **Backend sandbox (`backend.js`).**
  - `NODE_OPTIONS` treats a backslash inside quotes as an escape, so Windows paths are doubled.
  - `cwd` must be the app folder, because the permission model also grants read access to the working directory.
  - The host environment is not inherited.
- **App origin checks (`views.js`).** `URL.origin` is `"null"` for custom schemes, so navigation checks compare protocol and host.
- **Secrets (`services.js`).** On Linux without a keyring, `safeStorage` only obfuscates, so secrets need developer mode there.
- **Ubuntu 24 CI.** The runner blocks the unprivileged user namespaces Chromium's sandbox needs, so `ci.yml` turns them on before e2e.
- **CI job logs** are not always reachable, so `ci.yml` puts e2e failures in annotations.
- **ajv** ships CommonJS; under NodeNext its default import is the module object.
