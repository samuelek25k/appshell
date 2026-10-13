# Appshell

A repository-driven desktop platform on Electron: one governed shell, many independently delivered apps. Apps live in [appshell-apps](https://github.com/samuelek25k/appshell-apps).

```
pnpm install
pnpm start          # Appshell with apps from ../appshell-apps
pnpm check && pnpm test
pnpm e2e            # hostile-app isolation gate; needs a display (xvfb-run -a on Linux)
```

Release: push a `v*` tag; `.github/workflows/release.yml` builds the Windows installer and attaches it to the release.

Start with `AGENTS.md`. Contract: `docs/contracts.md`. Decisions: `docs/decisions.md`.
