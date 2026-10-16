# Platform contract (shell protocol 1, host 0.1)

What Appshell guarantees to apps and requires of them. Code: `packages/contracts/index.js`. Schemas: `packages/contracts/schemas/`.

## Product

One `product.json` per product (`product.schema.json`): name, deep-link protocol, data folder, package extension, installer maintainer (`Name <email>`, needed for Linux `.deb`), pre-installed apps, policy. Apps are resolved from the apps root: `--apps <dir>`, else `<product folder>/apps`.

`policy.capabilities`: `warn` logs undeclared capability use; `enforce` rejects it with `CAPABILITY_DENIED`. `policy.developerMode` allows secrets on Linux without an OS keyring.

## App

A folder with `manifest.json` (`manifest.schema.json`). `engines.appshell` is a caret range (`^0.1`) matched against the host's engine version (`appshell.engine` in `packages/host/package.json`), which changes only when this contract does; the product version is separate. For 0.x the minor version must match. Entries must stay inside the app folder. Backends should be `.cjs` or `.mjs` so their format never depends on a parent `package.json`.

## Isolation (proved by `test/e2e/hostile.test.js`)

| Boundary | How |
| --- | --- |
| UI | Own `WebContentsView`, `sandbox`, `contextIsolation`, no Node, origin `app://<id>/`, session partition `persist:app:<id>` |
| Files | The partition's protocol handler serves only the app's own folder (symlinks resolved) plus `/__appshell/sdk.js` |
| Network | Own origin, `data:`, `blob:`, and `https`/`wss` to hosts in `capabilities.network` (plus `http`/`ws` for declared loopback hosts: `localhost`, `127.0.0.0/8`, `::1`); everything else is cancelled. CSP mirrors this |
| Browser | All permission requests denied; `window.open`, webviews and navigation off the app origin blocked |
| Backend | `utilityProcess` with Node permission model: reads only its folder (also its working directory), no writes, child processes or workers; host environment not inherited |

Enforced by preload: backend network limits (TCP, UDP, DNS lookup & resolution). Not yet enforced: package signing (D12).

## Catalog and installs

`product.catalog` points at an `index.json` (`catalog.schema.json`): apps with their repository and releases (`version`, `channel`, `url`, `sha256`, `commit`), plus optional store listing fields (`description`, `categories`, `icon`, `screenshots`; images are https URLs or paths relative to the catalog). The host shows the newest release in `policy.channel` (`beta` also sees stable).

Install and update download the package, then refuse it unless:
- the repository and release URL start with an entry in `policy.allowedSources` (`file://` needs developer mode);
- its SHA-256 equals the catalog's;
- it contains only regular files and folders inside the package;
- its manifest id and version equal the catalog's, and its engine range accepts the host.

Install links: `<protocol>://_/install/<app-id>` (for example from a store web page) opens the host and asks the user to confirm. The link carries only an id from the product's own catalog, never a URL, so a web page cannot make the host fetch anything else. `_` is never a valid app id.

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
| `shell.getLocale` | | |
| `shell.getTheme` | | |
| `shell.getVersions` | | |
| `iac.send` | `to` ≤ 64, `action` ≤ 64, `payload`, `launchIfNeeded` (optional) | `capabilities.iac` (permitting `to`) |
| `iac.publish` | `channel` (`[A-Za-z0-9_.-]{1,64}`), `data` | `capabilities.iac` (permitting `channel`) |
| `iac.subscribe` | `channel` (`[A-Za-z0-9_.-]{1,64}`) | `capabilities.iac` (permitting `channel`) |
| `iac.unsubscribe` | `channel` (`[A-Za-z0-9_.-]{1,64}`) | `capabilities.iac` (permitting `channel`) |

Limits: storage values ≤ 64 KB, ≤ 1 MB per app. Errors: `UNKNOWN_METHOD`, `INVALID_PARAMS`, `CAPABILITY_DENIED`, `BACKEND_UNAVAILABLE`, `BACKEND_TIMEOUT` (10 s), `BACKEND_ERROR`, `UNKNOWN_CALLER`, `INTERNAL`.
`shell.getVersions` returns `{ current, previous, installedAt }` for version tracking, schema migration, and stale key pruning.

## Identity

`identity.token` returns `{ token, expiresAt }`: a compact JWS (EdDSA) with `iss` (product data folder), `sub` (an installation-scoped persistent subject ID), `aud` (`app:<caller id>`, never chosen by the caller), `iat`, `exp` (5 minutes), `jti`. Verify with `identity.publicKey` (JWK); `verifyToken` in `packages/host/src/identity.js` is a reference. The signing key and subject stay in the host's data folder (file mode 0600).

Claims: `sub` is the active account id (`local:<uuid>` or `guest:<uuid>`), `type` is `local` or `guest`, `name` is the account name (omitted for guests).

## Accounts (D24)

A product has several local accounts and at most one temporary Guest. Apps are shared; each account has its own app storage, secrets, app logs and browser partitions. The audit log is global. Switching accounts stops all running apps first. Guests cannot install or remove apps and are wiped when they leave or the host restarts; `policy.allowGuest: false` disables Guest. Removing an account deletes its data; the active account and the last account cannot be removed.

A PIN (4 to 64 characters, stored as a salted scrypt hash, 5 failures lock it for 30 seconds) only controls who may open the account in the host UI. It does not encrypt the account's data on disk. Proved by `test/accounts.test.js`.

## Launchers (D25)

An app with `"kind": "launcher"` and `capabilities.launcher: true` can be chosen per account (Settings, Home screen) to fill the home area in place of the built-in dashboard. A launcher is never opened as an ordinary app and never gets back or close controls. Calls, all needing the capability:

| Method | Result |
| --- | --- |
| `launcher.apps` | installed non-launcher apps not blocked by policy: `id`, `title`, `publisher`, `running` |
| `launcher.widgets` | the widgets apps have published |
| `launcher.open` `{ id }` | opens an app; `false` for launchers and unknown ids |
| `launcher.setTheme` `{ source?, colors? }` | `source` is `system`, `light` or `dark`; `colors` may set only `brand`, `panel` and `ink` as `#rrggbb` |

The host sends `launcher.changed` when apps or widgets change. Colours are stored with the account and cleared when another launcher or the dashboard is chosen. If a launcher fails to load or its process dies, the host shows the dashboard for the rest of the session. The host hides the launcher while its own menus and dialogs are open. Proved by `test/launcher.test.js` and `test/e2e/launcher.test.js`.

## Events (host to app, `appshell.on(name, fn)`)

| Event | Payload | Expected reply |
| --- | --- | --- |
| `shell.closeRequested` | `{ nonce }` | `shell.closeResponse` within 600 ms, else the app closes |
| `shell.deepLink` | `{ path }` | from `<protocol>://<app-id>/<path>`; one link per launch (Windows exits when given two), later launches hand theirs to the running host |
| `shell.themeChanged` | `{ source, dark }` | sent when theme preference or system mode changes |
| `shell.localeChanged` | `{ locale, languages, direction, timeZone }` | sent when system locale or language changes |
| `widgets.action` | `{ widget, action }` | sent after the host brings the app to the front |
| `storage.changed` | `{ key, value }` | sent when app storage key is mutated |
| `iac.message` | `{ from, action, payload, timestamp }` | sent when targeted IAC message arrives |
| `iac.broadcast` | `{ channel, from, data, timestamp }` | sent when topic broadcast arrives |

Back goes back in the app's history, or home when there is none. Home hides the app and keeps it running.

## Widgets

Descriptors (`widget.schema.json`) hold up to 8 blocks: `text`, `metric`, `list`, `actions`. The host renders them with its own components; app strings are never parsed as HTML. Widgets appear once the app has run.

## Backend

`entry.backend` runs on first `backend.call`, stops after 60 s idle, and stops for good after 3 crashes. Messages in: `{ id, method, params }` on `process.parentPort`. Out: `{ id, result }` or `{ id, error: { code, message } }`. `@appshell/sdk/backend` (`serve(handlers)`) implements this; copy it into the app folder. Outbound network requests (`fetch`, `http`, `https`, `tls`, `net`, `dgram`, `dns`) are restricted by preload to hosts declared in `capabilities.network`.

## Governance & Audit

Product policies govern app permissions, life cycle, and administrative control (`product.schema.json`):
- `policy.capabilities`: defaults to `'enforce'` (rejections throw `CAPABILITY_DENIED`), or `'warn'`.
- `policy.blockedApps`: array of prohibited app IDs blocked from installation, launch, and IAC messaging.
- **Audit Log (`logs/audit.log`)**: append-only JSONL log recording sensitive life cycle events (`APP_STARTED`, `APP_INSTALLED`, `APP_ROLLEDBACK`, `APP_UNINSTALLED`, `APP_LAUNCH_BLOCKED`, `APP_INSTALL_BLOCKED`, `CAPABILITY_DENIED`, `TOKEN_ISSUED`, `IAC_MESSAGE_SENT`, `IAC_PUBLISHED`, `IAC_DENIED`) with ISO timestamp, actor, target app, and details. Capped with log rotation at 2 MB.

## Localization & Internationalization (D15)

The host provides locale-aware environment detection:
- `shell.getLocale`: returns `{ locale, languages, direction, timeZone }`. Apps query this on launch to initialize translations and RTL layouts (`'ltr' | 'rtl'`).
- `product.schema.json` supports `defaultLocale` under policy.

## Inter-App Communication (IAC) (D17)

Host-mediated messaging and topic pub/sub broadcasting:
- **Zero Cross-Origin Access**: Apps never communicate directly and never receive references to another app's DOM, origin (`app://<id>/`), or `WebContents`. All events flow through the host as an authenticated broker.
- **Permission Scoping**: Both sender and receiver must declare `capabilities.iac` in `manifest.json`. Senders declare authorized targets in `send: string[]` (or `["*"]`). Receivers must explicitly list authorized senders in `receive: string[]` (or `["*"]`); declaring `iac: true` or `send` without an explicit `receive` list denies incoming messages. Topic pub/sub requires declaring `channels: string[]`.
- **Payload & Rate Limits**: Messages and broadcast payloads are capped at 64 KB. The host enforces a rate limit of 50 messages/sec per app; messages exceeding this rate reject with `CAPABILITY_DENIED` and are recorded in `logs/audit.log`.
- **Targeted Messaging (`iac.send`)**: Sends targeted actions/payloads from App A to App B (`iac.send({ to, action, payload, launchIfNeeded })`). Returns `{ delivered, targetRunning }`. Target app receives `iac.message`. `launchIfNeeded` is only permitted if the target explicitly allows receiving from the sender.
- **Topic Pub/Sub (`iac.publish` / `iac.subscribe` / `iac.unsubscribe`)**: Apps subscribe to named channels and receive `iac.broadcast` events when another app publishes to that channel.
- **Security & Audit**: The host verifies and stamps the caller's origin (`from: caller.id`). Unsolicited messages to apps that do not permit the sender are rejected with `CAPABILITY_DENIED`. Apps in `policy.blockedApps` cannot send or receive messages. Events are recorded in `logs/audit.log` (`IAC_MESSAGE_SENT`, `IAC_PUBLISHED`, `IAC_DENIED`).
