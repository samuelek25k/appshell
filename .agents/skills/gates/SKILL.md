---
name: gates
description: Run the pre-merge gates (hygiene, types, unit tests) and summarise failures.
---

# Gates

Run `pnpm hygiene && pnpm check && pnpm test`. Report pass or fail per gate and, for a failure, the failing test or file with its first error line. Fix what is in scope; protected paths are proposed, not edited. Run `pnpm e2e` too when the host, bridge or isolation changed (the `run-e2e` skill covers a root shell).
