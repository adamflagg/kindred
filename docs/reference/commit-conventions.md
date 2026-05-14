# Commit Type Selection

> Referenced from `CLAUDE.md` → Daily Workflow → Commit Conventions. The commit
> *scope* table lives in `CLAUDE.md`; this file is the commit *type* decision
> procedure.

Pick the most specific type before defaulting to `feat`/`fix`. The release
changelog groups by type, so mis-typing hides work (e.g. `chore` and `ci` are
skipped from the changelog entirely).

**Decision order — use the first that matches:**

1. Diff touches only `.github/workflows/` → `ci`
2. Diff touches only `docs/` or top-level markdown → `docs`
3. Diff touches only `tests/` or `*_test.*` / `*.test.*` files → `test`
4. Diff touches only Dockerfiles, `docker-compose.*`, `pyproject.toml`
   build config, or `package.json` dep pins → `build`
5. Diff touches only formatting (prettier, ruff format, whitespace) → `style`
6. Measurable performance improvement with no behavior change → `perf`
7. Code restructure with no behavior change (extract helper, rename, move) → `refactor`
8. Fixes a bug that was previously broken → `fix`
9. Adds new user-visible functionality or endpoint → `feat`
10. Reverts a prior commit → `revert`
11. Config files (env schema, settings) that aren't build tooling → `config`
12. Pure maintenance (dep bumps, internal tooling) with no user impact → `chore`

**Common mis-types to avoid:**
- Refactor that moves code but doesn't add features → `refactor`, not `feat`
- Test-only additions or fixes → `test`, not `feat`/`fix`
- Perf improvement (caching, memoization, algorithm change) → `perf`, not `refactor`
- Dockerfile change → `build`, not `ci`
- GitHub Actions change → `ci`, not `build`

**When unsure between two types**, pick the one whose *primary effect* dominates
the diff — e.g. a refactor that happens to fix one minor bug is still
`refactor` if restructuring is the point.
