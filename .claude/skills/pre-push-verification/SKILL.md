---
name: pre-push-verification
description: Use before committing, pushing, or claiming implementation is complete. Runs appropriate linters, type checkers, and tests based on which files changed. MUST be invoked before any success claims.
---

# Pre-Push Verification

**TRIGGER**: Run this skill BEFORE any of these actions:
- Claiming "done", "complete", "tests pass", or "implementation is finished"
- Running `git commit` or `git push`
- Telling the user that changes are ready for review

**NEVER claim success without actually running the commands below and showing their output.**

## Step 1: Detect What Changed

Run the verification script to detect changed file types and execute all relevant checks:

```bash
bash /path/to/repo/.claude/skills/pre-push-verification/scripts/verify.sh
```

Or from the repo root:

```bash
bash .claude/skills/pre-push-verification/scripts/verify.sh
```

Use `--all` to run every check regardless of what changed:

```bash
bash .claude/skills/pre-push-verification/scripts/verify.sh --all
```

## Step 2: If the Script Fails

The script exits non-zero on any failure. When it fails:

1. **Read the output** -- it tells you exactly which check failed
2. **Fix the issue** -- common fixes listed in the area-specific checklists below
3. **Re-run the script** -- do not claim success until it passes clean

## Step 3: Area-Specific Checklists

The script handles detection automatically, but if you need to run checks manually or understand what each area requires, consult:

| Changed files match | Checklist |
|---|---|
| `**/*.py`, `pyproject.toml`, `ruff.toml` | [Python checks](checklists/python.md) |
| `pocketbase/**/*.go`, `.golangci.yml` | [Go checks](checklists/go.md) |
| `frontend/**/*.{ts,tsx,js,jsx,css}` | [Frontend checks](checklists/frontend.md) |
| `pocketbase/pb_migrations/*.js` | [Migration checks](checklists/migration.md) |

## Gotchas -- Read These

### Format BEFORE lint
Python: `ruff format` must run before `ruff check`. Formatting changes can introduce or resolve lint errors. The script handles this order automatically.

### mypy uses `--explicit-package-bases`
The lefthook pre-push hook runs `uv run mypy . --explicit-package-bases`. Always include that flag. Without it, mypy may fail to resolve cross-package imports.

### Frontend lint runs on changed files only
The script passes only `.ts`/`.tsx` files changed since `@{push}` (or merge-base on first push) to `npx eslint --report-unused-disable-directives`. This matches `npm run lint`'s ruleset but skips the directory walk. Prettier is similarly file-scoped (`.ts/.tsx/.js/.jsx/.css/.json`). If you need a full-repo lint, run `npm run lint` from `frontend/` directly.

### Frontend type-check checks TWO tsconfigs
`npm run type-check` runs `tsc --noEmit && tsc --noEmit -p tsconfig.node.json`. Both must pass. If you only run one, you may miss errors in Vite config files. Type-check is NOT file-scoped — signature changes propagate, so it always runs over the whole project.

### Frontend vitest runs only affected tests
The script runs `npx vitest run --changed $BASE`, which uses vitest's dependency graph to skip test files whose source dependencies are unchanged. On small PRs this cuts a 4000+ test run to dozens. Use `--all` to bypass.

### Frontend checks run in parallel
prettier, eslint, tsc, and vitest run concurrently with per-tool output captured to a tempdir; results replay in stable order after all complete. Wall time ≈ slowest single check, not sum.

### `BASE` defaults to `@{push}`
The "what changed" reference for both file detection and `vitest --changed` is `git @{push}` (the upstream-tracked tip), so subsequent pushes on a PR only re-verify new unpushed commits. First push to a new branch falls back to `merge-base HEAD origin/main`. Outside any remote-tracking branch, falls back to `HEAD~1`.

### Python tests run only unit tests on push
The pre-push hook runs `uv run pytest tests/unit/ -v --tb=short`, not the full test suite. Integration tests require a running server and are not part of pre-push.

### Go tests use `-race` flag
The pre-push hook runs `go test -race ./... -v`. The race detector catches data races that normal tests miss. Do not skip it.

### PocketBase JS files have their own eslint
Migration and hook JS files are linted separately via `cd pocketbase && npm run lint` (which runs `eslint pb_migrations pb_hooks`). This is separate from the frontend eslint.

### Shell scripts are checked by shellcheck
Any `.sh` file changes trigger `shellcheck --severity=warning`. Fix warnings before pushing.

### Do not trust "it compiled" as proof of correctness
A successful `go build` or `tsc --noEmit` only proves type safety. You still need to run tests.

### The pre-push hook runs checks in parallel
Lefthook runs all pre-push checks simultaneously. A failure in one does not cancel others. The script mirrors this: it runs all relevant checks and reports all failures at the end, not just the first one.
