# tests/

Pytest for Python (`bunking/` + `api/`). See `frontend/CLAUDE.md` for Vitest. Layout: `unit/` (mirrors `api/`, `bunking/`, `scripts/`, …), `integration/` (`pocketbase/`, `solver/`, `sync/`), `e2e/`, `performance/`, plus `fixtures/` and `setup/`.

## Marker discipline — strict mode

`pyproject.toml` runs pytest with strict marker mode. **An unregistered marker is a failure.** When adding a marker, register it in `pyproject.toml` first.

### Skipped-in-CI tests

What actually gates a test out of CI and pre-push is the `SKIP_POCKETBASE_TESTS` env var (both set it), applied in conftests rather than by marker name:

| Gate | Effect |
|------|--------|
| `tests/integration/sync/` | Ignored when `SKIP_POCKETBASE_TESTS` is set (`tests/integration/conftest.py`). `integration/solver/` is pure Python and **always runs**. |
| `tests/e2e/`, `tests/performance/` | Ignored when `SKIP_POCKETBASE_TESTS` is set; they run in CD against the booted stack. |
| `requires_pb_db` (`tests/markers.py`) | A `skipif` on the same env var. Hits PocketBase's SQLite directly, so it needs a real `data.db`. Runs locally and in CD. |
| `ai_required`, `pocketbase_required` | Registered in `pyproject.toml` as labels (`pocketbase_required` is used once, in `tests/unit/sync/test_schema_validation.py`; `ai_required` by nothing yet). Neither skips anything by itself, so do not rely on them to keep a test out of CI. Run those tests locally with `AI_API_KEY` set / `./scripts/start_dev.sh` up. |

**CI passing does not mean these tests passed.** Verify locally before merging features that touch AI or DB paths.

## Test data — fictional only

NEVER use real camper/parent/staff/school names in tests, fixtures, comments, or assertions. Per `CLAUDE.md`:

- **Campers**: Emma Johnson, Liam Garcia, Olivia Chen, Riley Sam, Samuel Johnson
- **Schools**: Riverside Elementary, Oak Valley Middle, Hillcrest High
- **Phone/email**: 555-0100, <test@example.com>
- **IDs**: 1000001, 1000002 (generic, not real CampMinder IDs)

If you find real names in existing tests, replace them in the same PR.

## TDD discipline

Write failing tests **first**, verify they fail (red phase), then implement. Tests and implementation can land in the same commit (squash merge), but the workflow must be tests-first. **Modifying tests to match implementation behavior is forbidden** — tests are the spec.

## Run commands

```bash
uv run pytest tests/                                # all (CI markers respected)
uv run pytest tests/path/test_file.py::test_name    # single test
uv run pytest tests/ -k "keyword"                   # by keyword
SKIP_POCKETBASE_TESTS=true uv run pytest tests/     # explicit skip even locally
```

Pre-push runs type checks and fast linters (mypy, tsc, go build, ruff, shellcheck, pb-js-lint, markdownlint, guide-facts and api-types freshness) **plus the full mockable Python suite** (`SKIP_POCKETBASE_TESTS=true uv run pytest tests/ -n auto`). Vitest, eslint and golangci-lint are CI-only — a clean pre-push does not cover them. DB/server-coupled tests (`requires_pb_db`, `integration/sync/`, `e2e/`, `performance/`) are skipped on both pre-push and CI — run them locally with a running dev server.

## Worktree gotcha

Worktrees don't have a running PocketBase by default. Integration tests that hit a live server (e.g. `test_metrics_retention.py`) will fail in a fresh worktree until `./scripts/start_dev.sh` is up. **Expected behavior, not a bug.** Don't "fix" by mocking the DB — see the no-mock-DB rule in your reviewer's feedback.

## Coverage

`.coverage` is a generated binary artifact — never `Read` it as a file. Use `uv run coverage report` instead.
