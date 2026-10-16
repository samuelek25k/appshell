# Contributing to Appshell

Thank you for contributing to Appshell!

Appshell is a repository-driven desktop platform on Electron designed with strict sandboxing and minimal liability.

## Principles

Before submitting a PR, make sure your changes follow our core principles:

1. **Third-party code is adversarial.** Core apps get no exemption. Never give app code Node, host IPC or another app's origin.
2. **Minimum liability.** Every line, dependency and abstraction is a commitment. Use Electron, Node and existing code first.
3. **No new dependency without a decision.** Add it to `docs/decisions.md` as Pending; only the product owner marks it Decided.
4. **No premature abstraction.** Add an adapter or plugin point only when a real second case exists.
5. **Contracts first.** Change `docs/contracts.md` and the schema in the same change as the code.
6. **Honest guarantees.** Never document protection the code does not enforce and a test does not prove.
7. **No product-specific code in `packages/`.** Products live in `products/`; `test/decoupling.test.js` enforces this.
8. **Delete dead code and stale docs in the same change.**

## Workflow

1. Inspect existing code and contracts before writing.
2. Write or update tests first when behaviour changes.
3. Verify all checks pass locally:
   ```bash
   pnpm check
   pnpm test
   pnpm secrets
   ```
4. Run `pnpm e2e` when the host, bridge, or isolation changes.
5. Review your diff for duplication, dead code, and context weight.

## Submitting Pull Requests

- Keep PRs small, focused, and atomic.
- Fill out the pull request template completely.
- Ensure all CI gates pass (types, tests, secretlint, decoupling, hostile-app gate).
