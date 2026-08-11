# bunking/

Core Python package: solver, data processing, satisfaction policy, social graphs, RBAC, geo, config. `api/` is a thin HTTP layer over this.

## Modules

| Module | Purpose |
|--------|---------|
| `solver/` | OR-Tools CP-SAT model — see `bunking/solver/CLAUDE.md` |
| `sync/bunk_request_processor/` | CSV → AI parse → name resolution → disposition pipeline |
| `satisfaction/` | Single source of truth for "is request X satisfied?" — RequestBucket policy, predicates, aggregation |
| `metrics/` | Analytics aggregation |
| `graph/` | Social graph construction + caching — `SocialGraphBuilder` is the public API |
| `rbac/` | FastAPI permission dependencies (Go has its own `pocketbase/rbac/`) |
| `geo_normalizer/` | City/state normalization against `uscities.csv` |
| `config/` | `ConfigLoader` — reads the PocketBase `config` table |
| `models_v2.py` | `DirectSolver*` dataclasses — solver I/O contract |
| `bunking_validator.py` | Analyzes assignments; consumed by `api/routers/validation.py` |
| `auth_middleware.py` / `jwt_auth.py` | PocketBase JWT verification for FastAPI |

## Where business logic lives

**Here, not in `api/`.** Routers should be thin: parse input, call into `bunking/`, return shape. Logic in a router is a smell — extract.

## Python conventions

- **Python 3.14+**, invoke via `uv run <cmd>`. Verify the interpreter with `uv run python` — NOT the system `python3` (often 3.12, which can misflag valid 3.14 syntax).
- **mypy strict mode** — `pyproject.toml` runs mypy with `strict = true`. All new Python must be fully type-annotated; pre-push fails otherwise. Invoke it the way the hook and CI do: `uv run mypy . --explicit-package-bases`. **The flag is not optional** — without it mypy cannot resolve cross-package imports in this layout, so a bare `uv run mypy .` reports errors the gates do not.
- **Line length 120** — configured in `ruff.toml`, enforced by `ruff format`.

## Logging

```python
from bunking.logging_config import configure_logging, get_logger
logger = get_logger(__name__)
```

Format: `2026-01-06T14:05:52Z [bunking] LEVEL message key=value...`. `LOG_LEVEL=INFO` (default) suppresses noise; `DEBUG` for verbose.

## Tests

```bash
uv run pytest tests/                                # all (CI markers respected)
uv run pytest tests/path/test_file.py::test_name    # single
uv run pytest tests/ -k "keyword"                   # by keyword
```

See `tests/CLAUDE.md` for marker semantics (some tests are skipped in CI).

## Domain references

- `docs/architecture/sync-layer.md` — read before touching sync jobs
- `docs/architecture/bunk-request-pipeline.md` — CSV upload, AI parse, name resolution
- `docs/architecture/metrics-module.md` — adding/modifying metrics
- `docs/architecture/session-types.md` — sessions, bunking, AG logic
