# Appshell

A repository-driven desktop platform on Electron: one governed shell, many independently delivered apps. Apps live in [appshell-apps](https://github.com/samuelek25k/appshell-apps).

```
pnpm install
pnpm start          # Appshell with apps from ../appshell-apps
pnpm check && pnpm test
pnpm e2e            # hostile-app isolation gate; needs a display (xvfb-run -a on Linux)
```

App authors use the CLI (`packages/cli`):

```
pnpm appshell create ../my-app --id my-app --title "My App"
pnpm appshell dev ../my-app        # run it in a development host
pnpm appshell package ../my-app    # <id>-<version>.tgz plus its SHA-256
pnpm appshell catalog add index.json --app ../my-app --repository <url> --url <release-url> --sha256 <hex> --commit <sha>
```

Release: push a `v*` tag; `.github/workflows/release.yml` builds the Windows installer and attaches it to the release.

Start with `AGENTS.md`. Contract: `docs/contracts.md`. Decisions: `docs/decisions.md`.
