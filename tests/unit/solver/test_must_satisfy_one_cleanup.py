"""Pin the must_satisfy_one + age_preference cleanup.

Three config keys are deleted because their off-paths are dead, broken, or
actively wrong:
  - ``constraint.must_satisfy_one.enabled`` (off-path dead)
  - ``constraint.must_satisfy_one.fallback_to_age`` (off-path breaks age-only
    coverage path)
  - ``constraint.must_satisfy_one.ignore_impossible_requests`` (off-path
    injects guaranteed false soft-violations)

Stage 4 (#1379) extension: ``constraint.must_satisfy_one.penalty`` is also
removed — the soft constraint was replaced by a hard CP-SAT constraint
over Material-Parent requests only, so the penalty knob is dead config.

Also deletes the ``add_age_preference_penalties`` function (~75 LOC, zero
callers since initial commit, reads phantom config key
``constraint.age_preference.penalty`` that was never seeded).

These tests pin the schema, the module sources, the constraints __init__
exports, and the new delete migration so a future regression that reintroduces
any of the deleted keys or the orphan function fails fast.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

# Schema -----------------------------------------------------------------------


def test_schema_drops_enabled_fallback_ignore_impossible() -> None:
    from bunking.config.schema import CONFIG_SCHEMA

    deleted_keys = (
        "constraint.must_satisfy_one.enabled",
        "constraint.must_satisfy_one.fallback_to_age",
        "constraint.must_satisfy_one.ignore_impossible_requests",
    )
    for key in deleted_keys:
        assert key not in CONFIG_SCHEMA, f"{key} must be removed from CONFIG_SCHEMA"


def test_schema_drops_penalty() -> None:
    from bunking.config.schema import CONFIG_SCHEMA

    assert "constraint.must_satisfy_one.penalty" not in CONFIG_SCHEMA, (
        "constraint.must_satisfy_one.penalty must NOT be in CONFIG_SCHEMA — "
        "removed in Stage 4 (#1379) when soft MSO became hard MP constraint"
    )


# must_satisfy.py source -------------------------------------------------------


def _must_satisfy_source() -> str:
    import bunking.solver.constraints.parent_paramount as mod

    return inspect.getsource(mod)


def test_must_satisfy_module_drops_enabled_read() -> None:
    src = _must_satisfy_source()
    assert not re.search(r'get_constraint\(\s*"must_satisfy_one"\s*,\s*"enabled"', src), (
        "must_satisfy.py must not call get_constraint(must_satisfy_one, enabled, ...) — toggle is always on"
    )


def test_must_satisfy_module_drops_fallback_read() -> None:
    src = _must_satisfy_source()
    assert not re.search(r'get_constraint\(\s*"must_satisfy_one"\s*,\s*"fallback_to_age"', src), (
        "must_satisfy.py must not call get_constraint(must_satisfy_one, fallback_to_age, ...)"
    )
    assert "fallback_to_age" not in src, "fallback_to_age variable must be gone from must_satisfy.py"


def test_must_satisfy_module_drops_ignore_impossible_read() -> None:
    src = _must_satisfy_source()
    assert "constraint.must_satisfy_one.ignore_impossible_requests" not in src, (
        "must_satisfy.py must not read constraint.must_satisfy_one.ignore_impossible_requests"
    )
    assert "ignore_impossible" not in src, "ignore_impossible variable must be gone from must_satisfy.py"


# age_preference.py source -----------------------------------------------------


def _age_preference_source() -> str:
    import bunking.solver.constraints.age_preference as mod

    return inspect.getsource(mod)


def test_age_preference_module_drops_penalties_function() -> None:
    src = _age_preference_source()
    assert "def add_age_preference_penalties" not in src, (
        "add_age_preference_penalties function must be removed — orphan, zero callers"
    )


def test_age_preference_module_drops_phantom_config_read() -> None:
    src = _age_preference_source()
    assert "constraint.age_preference.penalty" not in src, (
        "age_preference.py must not reference the phantom config key constraint.age_preference.penalty"
    )


# constraints/__init__.py ------------------------------------------------------


def test_constraints_init_drops_age_preference_penalties_export() -> None:
    import bunking.solver.constraints as pkg

    assert not hasattr(pkg, "add_age_preference_penalties"), (
        "constraints package must not export add_age_preference_penalties anymore"
    )


# New delete migration --------------------------------------------------------


def _migration_text() -> str:
    repo_root = Path(__file__).resolve().parents[3]
    path = repo_root / "pocketbase" / "pb_migrations" / "1500000096_drop_dead_mso_config.js"
    assert path.exists(), f"Migration file missing: {path}"
    return path.read_text()


def test_migration_drops_three_must_satisfy_one_rows() -> None:
    text = _migration_text()
    for key in ("enabled", "fallback_to_age", "ignore_impossible_requests"):
        assert f'"{key}"' in text, f'Migration must reference config_key "{key}" for deletion'


def test_migration_uses_subcategory_must_satisfy_one() -> None:
    text = _migration_text()
    assert 'subcategory = "must_satisfy_one"' in text, 'Migration filter must scope to subcategory = "must_satisfy_one"'
