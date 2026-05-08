# Python Verification Checklist

All commands run from the repository root.

## 1. Format (must run first)

```bash
uv run ruff format .
```

This auto-fixes formatting. Run it BEFORE linting because format changes can resolve or introduce lint issues.

**Line length**: 120 chars (configured in `ruff.toml`).

## 2. Lint

```bash
uv run ruff check --fix .
```

The `--fix` flag auto-fixes safe issues (unused imports, import sorting, etc.). Review the fixes before committing.

If issues remain after `--fix`, they require manual intervention. Common unfixable issues:
- `T201` (print statements) -- replace with logger calls using `from bunking.logging_config import get_logger`
- `S101` (assert in production code) -- use proper error handling instead
- `N802`/`N803` (naming) -- rename to snake_case
- `DTZ005` (naive datetime) -- add timezone info

## 3. Type Check

```bash
uv run mypy . --explicit-package-bases
```

**Critical flag**: `--explicit-package-bases` is required. Without it, mypy cannot resolve cross-package imports in this project's layout.

Common mypy failures and fixes:
- **Missing return type**: Add `-> None` or the appropriate type
- **Incompatible types**: Check if you need `Optional[X]` instead of `X`
- **Missing stubs**: Third-party packages without stubs are configured in `pyproject.toml` under `[[tool.mypy.overrides]]`. Add new packages there if needed.
- **`Any` type leaking**: Strict mode disallows untyped defs. Add type annotations.

## 4. Tests

```bash
uv run pytest tests/unit/ -v --tb=short
```

This runs only unit tests (matching the pre-push hook). Integration tests require a running PocketBase server and are not part of pre-push verification.

To run a specific test:
```bash
uv run pytest tests/unit/path/test_file.py::test_name -v --tb=short
```

## Common Gotchas

- **Import order matters**: `ruff check --fix` will auto-sort imports, but sometimes this breaks circular imports. If tests fail after auto-fix, check import changes.
- **Per-file ignores**: Test files (`tests/**/*.py`) and scripts (`scripts/**/*.py`) have relaxed rules (see `ruff.toml` `[lint.per-file-ignores]`). Do not add production code under these paths to avoid weaker linting.
- **mypy strict mode**: All of `disallow_untyped_defs`, `disallow_untyped_calls`, `disallow_incomplete_defs` are enabled. Test files have relaxed overrides, but production code must be fully typed.
- **Python version**: mypy targets Python 3.14 (`python_version = "3.14"` in `pyproject.toml`). Do not use features removed in 3.14.
