---
name: store-screenshots
description: Capture app store screenshots (the app's own view and the dashboard with its widgets) for an Appshell app, for its listing in appshell-apps.
---

# Store screenshots

1. From an `appshell` checkout with dependencies installed, run under a display (on Linux: `xvfb-run -a -s "-screen 0 1200x800x24"`, see the electron-headless skill):
   `node .claude/skills/store-screenshots/scripts/capture.mjs <app-dir> <app-dir>/store`
2. If `<app-dir>/store/prepare.js` exists, it runs in the app page first (an async expression) to add realistic content; `store/` is never packaged.
3. It writes `screenshot-1.png` (the app) and `screenshot-2.png` (dashboard and widgets). Look at both before committing.
4. List them in `<app-dir>/store/listing.json` under `screenshots`, relative to the app folder. The release workflow copies listing fields into the catalog and leaves `store/` out of the package.
