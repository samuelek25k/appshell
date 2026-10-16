## Summary

<!-- Briefly describe the changes and motivation -->

## Checklist

- [ ] Deterministic checks pass: `pnpm check && pnpm test && pnpm secrets`
- [ ] If host, bridge, or isolation changed: `pnpm e2e` passes
- [ ] No product-specific code in `packages/` (`test/decoupling.test.js`)
- [ ] No new dependencies added, OR documented in `docs/decisions.md` as Pending
- [ ] Contracts (`docs/contracts.md`) and schemas updated in the same change
- [ ] Dead code, unused imports, and stale docs removed
