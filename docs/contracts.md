# Platform contract (shell protocol 1, host 0.1)

What Appshell guarantees to apps and requires of them. Code: `packages/contracts/index.js`. Schemas: `packages/contracts/schemas/`.

## Product

One `product.json` per product (`product.schema.json`): name, deep-link protocol, data folder, package extension, pre-installed apps, policy. Apps are resolved from the apps root: `--apps <dir>`, else `<product folder>/apps`.

`policy.capabilities`: `warn` logs undeclared capability use; `enforce` rejects it with `CAPABILITY_DENIED`. `policy.developerMode` allows secrets on Linux without an OS keyring.

## App

A folder with `manifest.json` (`manifest.schema.json`). `engines.appshell` is a caret range (`^0.1`); for 0.x the minor version must match. Entries must stay inside the app folder. Backends should be `.cjs` or `.mjs` so their format never depends on a parent `package.json`.

## Isolation (proved by `test/e2e/hostile.test.js`)

| Boundary | How |
| --- | --- |
| UI | Own `WebContentsView`, `sandbox`, `contextIsolation`, no Node, origin `app://<id>/`, session partition `persist:app:<id>` |
| Files | The partition's protocol handler serves only the app's own folder (symlinks resolved) plus `/__appshell/sdk.js` |
| Network | Own origin, `data:`, `blob:`, and `https`/`wss` to hosts in `capabilities.network`; everything else is cancelled. CSP mirrors this |
| Browser | All permission requests denied; `window.open`, webviews and navigation off the app origin blocked |
| Backend | `utilityProcess` with Node permission model: reads only its folder (also its working directory), no writes, child processes or workers; host environment not inherited |

Not yet enforced: network limits for backends (Phase 2), signing (D12).

## Catalog and installs

`product.catalog` points at an `index.json` (`catalog.schema.json`): apps with their repository and releases (`version`, `channel`, `url`, `sha256`, `commit`). The host shows the newest release in `policy.channel` (`beta` also sees stable).

Install and update download the package, then refuse it unless:
- the repository and release URL start with an entry in `policy.allowedSources` (`file://` needs developer mode);
- its SHA-256 equals the catalog's;
- it contains only regular files and folders inside the package;
- its manifest id and version equal the catalog's, and its engine range accepts the host.

Installed apps live in `<userData>/installed/<id>/<version>/`, with provenance (repository, commit, URL, digest, time) in `installed.json`. The previous version is kept for rollback. Remove deletes every version and the app's data. Running apps stop before any change. Pre-installed (protected) apps cannot be changed from the catalog.

## Bridge

UI: `await window.appshell.call(method, params)`; failures reject with `Error("<CODE>: <message>")`. Use `import … from '/__appshell/sdk.js'` for typed wrappers. The host identifies the caller by its view, never by the message.

| Method | Params | Needs |
| --- | --- | --- |
| `shell.hello` | | |
| `shell.setTitle` | `title` ≤ 60 | |
| `shell.closeResponse` | `nonce`, `allow` | |
| `widgets.update` | `id`, `descriptor` | widget `id` in manifest |
| `storage.get` / `.set` / `.remove` | `key` (`[A-Za-z0-9_.-]{1,64}`), `value` | |
| `secrets.get` / `.set` | `name`, `value` ≤ 4096 | `name` in `capabilities.secrets` |
| `notifications.show` | `title` ≤ 80, `body` ≤ 280 | `capabilities.notifications` |
| `log.write` | `level`, `message` ≤ 2000 | |
| `backend.call` | `method`, `params` | `entry.backend` |
| `identity.token` | | `capabilities.identity` |
| `identity.publicKey` | | |

Limits: storage values ≤ 64 KB, ≤ 1 MB per app. Errors: `UNKNOWN_METHOD`, `INVALID_PARAMS`, `CAPABILITY_DENIED`, `BACKEND_UNAVAILABLE`, `BACKEND_TIMEOUT` (10 s), `BACKEND_ERROR`, `UNKNOWN_CALLER`, `INTERNAL`.

## Identity

`identity.token` returns `{ token, expiresAt }`: a compact JWS (EdDSA) with `iss` (product data folder), `sub` (installation id), `aud` (`app:<caller id>`, never chosen by the caller), `iat`, `exp` (5 minutes), `jti`. Verify with `identity.publicKey` (JWK); `verifyToken` in `packages/host/src/identity.js` is a reference. The signing key stays in the host's data folder (file mode 0600).

## Events (host to app, `appshell.on(name, fn)`)

| Event | Payload | Expected reply |
| --- | --- | --- |
| `shell.closeRequested` | `{ nonce }` | `shell.closeResponse` within 600 ms, else the app closes |
| `shell.deepLink` | `{ path }` | from `<protocol>://<app-id>/<path>`; one link per launch (Windows exits when given two), later launches hand theirs to the running host |
| `widgets.action` | `{ widget, action }` | sent after the host brings the app to the front |

Back goes back in the app's history, or home when there is none. Home hides the app and keeps it running.

## Widgets

Descriptors (`widget.schema.json`) hold up to 8 blocks: `text`, `metric`, `list`, `actions`. The host renders them with its own components; app strings are never parsed as HTML. Widgets appear once the app has run.

## Backend

`entry.backend` runs on first `backend.call`, stops after 60 s idle, and stops for good after 3 crashes. Messages in: `{ id, method, params }` on `process.parentPort`. Out: `{ id, result }` or `{ id, error: { code, message } }`. `@appshell/sdk/backend` (`serve(handlers)`) implements this; copy it into the app folder.
