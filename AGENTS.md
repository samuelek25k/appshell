# AGENTS.md

Appshell is a repository-driven desktop platform on Electron. Read this file first; load other docs only when the task touches them.

## Where things are

| Need | Read |
| --- | --- |
| What the platform guarantees and its API | `docs/contracts.md` |
| Why something is built the way it is | `docs/decisions.md` |
| Schemas | `packages/contracts/schemas/` |
| Current state and what to build next | `TODO.md` |
| Reusable procedures | `.claude/skills/` |

## Principles

1. **Third-party code is adversarial.** Core apps get no exemption. Never give app code Node, host IPC or another app's origin.
2. **Minimum liability.** Every line, dependency and abstraction is a commitment. Use Electron, Node and existing code first.
3. **No new dependency without a decision.** Add it to `docs/decisions.md` as Pending; only the product owner marks it Decided.
4. **No premature abstraction.** Add an adapter or plugin point only when a real second case exists.
5. **Contracts first.** Change `docs/contracts.md` and the schema in the same change as the code.
6. **Honest guarantees.** Never document protection the code does not enforce and a test does not prove.
7. **No product-specific code in `packages/`.** Products live in `products/`; `test/decoupling.test.js` enforces this.
8. **Keep artifacts, context and extracts lean.** State the decision and its reason. History lives in git. Link instead of restating.
9. **Delete dead code and stale docs in the same change.**
10. **Leave an asset.** A solved problem becomes a test, a schema rule or a contract line. A procedure you repeat becomes a skill in `.claude/skills/<name>/` with its scripts.
11. **No comments.** Names say what the code does; `docs/decisions.md` says why. Only type tags (`@type`, `@param`, `@returns`, `@typedef`) are allowed in JSDoc. No change narration, design inspirations or wording from requests anywhere; sample data is fictional and generic. `pnpm hygiene` enforces this before every commit.
12. **Protected rules.** Files in `.github/protected-paths` change only in commits signed by the product owner; `rules-guard` blocks anything else. Agents propose such changes; they do not make them.

## Context hygiene

Do not read `node_modules/`, `out/`, `dist/`, `pnpm-lock.yaml` or binaries. Summarise long logs instead of pasting them. Never put secrets or real personal data in code, fixtures, logs or prompts.

## Workflow

1. Inspect existing code and contracts before writing.
2. Write or update the test first when behaviour changes.
3. Run `pnpm hygiene && pnpm check && pnpm test`; run `pnpm e2e` when the host, bridge or isolation changes.
4. Review your diff for duplication, dead code and context weight.

Deterministic checks (types, tests, secretlint, hygiene, decoupling, hostile app, rules-guard) block merges. AI review advises only. Unattended agent loops are off unless the product owner opts in.
