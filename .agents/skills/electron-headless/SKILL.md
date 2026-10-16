---
name: electron-headless
description: Run, drive and screenshot Electron (tests, spikes, UI checks) on a headless Linux box or CI, including behind a proxy where the Electron binary download fails.
---

# Run Electron headless

1. **Binary.** If `pnpm install` leaves Electron without its binary (proxy cuts the download), run `scripts/fetch-electron.sh <version>` and export the `ELECTRON_OVERRIDE_DIST_PATH` it prints.
2. **Display.** Wrap the command: `xvfb-run -a -s "-screen 0 1200x800x24" <command>`.
3. **Root.** As root, add `--no-sandbox`. This disables only Chromium's OS sandbox; per-view `sandbox: true` still applies. On Ubuntu 24 CI runners first run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
4. **Noise.** `dbus/bus.cc` errors are harmless; filter them before reading logs.
5. **Drive the UI.** Start Electron with `--remote-debugging-port=<port>` and run `scripts/cdp-eval.mjs <port> <url-prefix> "<js>"` to click, type or read state. No xdotool needed.
6. **See it.** Inside the same `xvfb-run` shell, `import -window root shot.png` (ImageMagick), then view the PNG.
7. **Renderer errors.** Log `webContents` `console-message` (level `error`) and `preload-error` events; a broken page otherwise fails silently.
8. **utilityProcess sandboxing.** Pass Node permission flags through `env.NODE_OPTIONS` (`execArgv` is ignored) and set `cwd` to the allowed folder: the permission model also grants read access to the working directory.
9. **Windows CI.** Electron 44 downloads its binary on first `require('electron')`; launched GUI processes print nothing to piped stderr, so write diagnostics to a file and surface them as `::error::` annotations (job logs may be unreachable through a proxy). Never pass two deep-link URLs in one launch: Windows exits with code -1.
