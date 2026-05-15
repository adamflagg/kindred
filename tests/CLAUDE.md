# tests/

Pytest for Python (`bunking/` + `api/`). See `frontend/CLAUDE.md` for Vitest. Layout: `unit/`, `integration/`, `e2e/`, `performance/`.

## Marker discipline — strict mode

`pyproject.toml` runs pytest with strict marker mode. **An unregistered marker is a failure.** When adding a marker, register it in `pyproject.toml` first.

### Skipped-in-CI markers

| Marker | When it runs |
|--------|--------------|
| `ai_required` | Skipped in CI (needs live AI tokens). Run locally with `AI_API_KEY` set. |
| `pocketbase_required` | Skipped in CI (needs running PocketBase). Run locally with `./scripts/start_dev.sh` up. |

**CI passing does not mean these tests passed.** Verify locally before merging features that touch AI or DB paths.

## Test data — fictional only

NEVER use real camper/parent/staff/school names in tests, fixtures, comments, or assertions. Per `CLAUDE.md`:

- **Campers**: Emma Johnson, Liam Garcia, Olivia Chen, Riley Sam, Samuel Johnson
- **Schools**: Riverside Elementary, Oak Valley Middle, Hillcrest High
- **Phone/email**: 555-0100, test@example.com
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

Pre-push runs the full unit suite. Integration/e2e require a running dev server.

## Worktree gotcha

Worktrees don't have a running PocketBase by default. Integration tests that hit a live server (e.g. `test_metrics_retention.py`) will fail in a fresh worktree until `./scripts/start_dev.sh` is up. **Expected behavior, not a bug.** Don't "fix" by mocking the DB — see the no-mock-DB rule in your reviewer's feedback.

## Coverage

`.coverage` is a generated binary artifact — never `Read` it as a file. Use `uv run coverage report` instead.
