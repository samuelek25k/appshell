---
name: run-e2e
description: Run the Electron end-to-end tests on a headless Linux box where the shell is root.
---

# Run e2e

The host refuses to start as root without a sandbox, so run the tests as an unprivileged user:

```sh
chown -R <user>: .
runuser -u <user> -- env HOME=<home of user> xvfb-run -a node --test --test-concurrency=1 test/e2e/*.test.js
chown -R root: .
```

Restore ownership afterwards: git refuses a repository owned by another user. Setup details are in the `electron-headless` skill.

Expect three passing tests: hostile app, catalog install and uninstall, template app. A failure that says `timed out waiting for file://` means the host did not start; run it by hand with `xvfb-run -a node_modules/.bin/electron packages/host --product products/appshell/product.json --user-data <tmp>` to see why.
