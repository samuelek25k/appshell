# Decision register

Every architecture, tooling and dependency choice is recorded here. Agents add entries as **Pending** with options and a recommendation; only the product owner marks one **Decided**.

| # | Decision | Status | Choice and reason |
| --- | --- | --- | --- |
| D1 | UI isolation | Decided 2026-10-13 | Each app runs in its own sandboxed `WebContentsView` on origin `app://<id>/` with session partition `persist:app:<id>`. The protocol handler of a partition serves only its own app, so cross-app fetches fail. |
| D2 | Widget model | Decided 2026-10-13 | Apps send JSON descriptors (`widget.schema.json`); the host renders them. No app code runs on the dashboard. |
| D3 | Shell protocol | Decided 2026-10-13 | Versioned messages over the bridge: hello with nonce, back, close with veto timeout, deep links. See `docs/contracts.md`. |
| D4 | Backend runtime | Decided 2026-10-13 | One `utilityProcess` per app, started on first call, stopped when idle, restarted on crash (max 3). Node permission model restricts filesystem reads to the app folder and blocks `child_process` and workers; the working directory is set to the app folder because the permission model also grants it read access. Host environment is not inherited. Network is not restricted until Phase 2. |
| D5 | Host–app bridge | Decided 2026-10-13 | One `appshell.call(method, params)` entry point. The host identifies the caller by its `webContents`, never by a claim in the message, and checks the manifest capability for each call (`policy.capabilities`: `warn` or `enforce`). |
| D6 | Product configuration | Decided 2026-10-13 | One `product.json` per product, validated by `product.schema.json`. JSON instead of YAML so validation needs no parser dependency. |
| D7 | Engineering harness | Decided 2026-10-13 | `AGENTS.md`, this register, secretlint in a husky pre-commit hook and CI, type check, tests, hostile app e2e. AI review advisory only. |
| D8 | Identity handoff | Decided 2026-10-13 | The host signs 5-minute Ed25519 JWTs with `aud: app:<id>` for apps that declare `capabilities.identity`; apps and their services verify with the host's public JWK. The key never leaves the host. `sub` is a per-installation id until SSO arrives. Node crypto, no dependency. |
| D9 | Install artifact | Decided 2026-10-13 | Gzipped tar of regular files only, built by CI, pinned in the catalog by SHA-256 and commit. The host verifies the digest, refuses links and paths outside the package, and checks the manifest id and version against the catalog. `file://` packages only in developer mode. |
| D10 | Discovery and providers | Decided 2026-10-13 | One catalog `index.json` per product (`catalog.schema.json`), from the product config. Repository and release URLs must match `policy.allowedSources`. No provider adapters: any HTTPS release URL works. |
| D11 | Versioning and updates | Decided 2026-10-13 | Semver releases on `stable` or `beta`; the product's `policy.channel` picks what users see. Current and previous versions stay on disk, so rollback needs no download. Updates are user-initiated in Phase 1. |
| D12 | Signing | Pending | Sigstore or internal PKI; decide in Phase 2. |

## Dependencies

| Package | Why | Status |
| --- | --- | --- |
| `electron` | The runtime. | Decided (D1) |
| `ajv` | JSON Schema validation for manifests, product config and widgets; the schemas are the contract. | Decided (D5, D6) |
| `typescript` (dev) | Type checks JSDoc-annotated JavaScript with `checkJs`; no build step. | Decided (D7) |
| `tar` | Reads and writes app packages; maintained by the npm team, used by npm itself. Node has no built-in tar. | Decided (D9) |
| `electron-builder` (dev) | Builds installers; the Windows `.exe` pipeline was requested by the product owner on 2026-10-13. Unsigned until D12. | Decided |
| `secretlint`, `@secretlint/secretlint-rule-preset-recommend`, `husky` (dev) | Secret scanning before commit and in CI. | Decided (D7) |

## Known risks

- **Backend permission flags travel through `NODE_OPTIONS`.** `utilityProcess` ignores `execArgv` permission flags. Hardened packaged builds that disable the `NODE_OPTIONS` fuse may drop them; run the hostile app against a packaged build before Phase 3 closes.
- **Local runs as root need `--no-sandbox`.** That disables Chromium's OS sandbox, not the per-view `sandbox` preference. CI runs unprivileged with the OS sandbox on.
