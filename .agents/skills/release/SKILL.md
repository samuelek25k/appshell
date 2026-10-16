---
name: release
description: Cut an Appshell release: check main, build a candidate on all platforms, verify it, hand the tag to the owner.
---

# Release

1. **Main is green.** Every `ci` job passes on the commit to release: `gh api repos/samuelek25k/appshell/commits/<sha>/check-runs`.
2. **Version.** `version` in `packages/host/package.json` is the release version. `appshell.engine` changes only when the app contract changes (D23).
3. **Candidate.** `gh workflow run release --ref main`, then wait for `ci` and the Windows, macOS and Linux `build` jobs. Installers land as run artifacts; `publish` is skipped without a tag. A re-run reuses its original commit, so after any fix start a new run.
4. **Verify on Windows.** Install the candidate, install a catalog app, run the hostile-app gate against the packaged build, uninstall, and check the install folder and the data folder are gone.
5. **Tag.** Agents cannot push tags: the owner runs `git tag -a vX.Y.Z <sha> -m "Appshell X.Y.Z"` and `git push origin vX.Y.Z`. The workflow refuses a tag that differs from the host version and publishes a draft release.
6. **Notes.** State that installers are unsigned until D22, with the macOS steps (System Settings, Privacy & Security, Open Anyway, or `xattr -dr com.apple.quarantine`) and Windows SmartScreen (More info, Run anyway).
7. **Publish.** The owner publishes the draft. `site/releases.html` links to `releases/latest/download` with the fixed names from `scripts/build-config.mjs`.

## Scripts

- Check release status and candidate build progress: `node .agents/skills/release/scripts/status.mjs`

