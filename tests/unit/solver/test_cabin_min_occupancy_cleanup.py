"""Pin Phase 2 cleanup of the Cabin Minimum Occupancy domain.

Five config keys collapse to:
  - ``MIN_BUNK_OCCUPANCY = 8`` constant (was ``constraint.cabin_minimum_occupancy.min``)
  - ``PREFERRED_BUNK_OCCUPANCY = 10`` constant (was ``...preferred``)
  - ``constraint.cabin_minimum_occupancy.penalty`` (KEPT — the lone tunable)

Deleted entirely:
  - ``constraint.cabin_minimum_occupancy.enabled`` (constraint is a staff invariant)
  - ``constraint.cabin_minimum_occupancy.force_all_used`` (gender-qualification + force-bind always run)

These tests pin the schema, the module source, and the seed migration so a
future regression that re-introduces any of the deleted keys, or that
silently reads the canonical ``.min`` / ``.preferred`` keys instead of the
constants, fails fast.
"""

from __future__ import annotations

import inspect
from pathlib import Path

# Schema -----------------------------------------------------------------------


def test_schema_drops_enabled_min_preferred_force_all_used():
    from bunking.config.schema import CONFIG_SCHEMA

    deleted_keys = (
        "constraint.cabin_minimum_occupancy.enabled",
        "constraint.cabin_minimum_occupancy.min",
        "constraint.cabin_minimum_occupancy.preferred",
        "constraint.cabin_minimum_occupancy.force_all_used",
    )
    for key in deleted_keys:
        assert key not in CONFIG_SCHEMA, f"{key} must be removed from CONFIG_SCHEMA in Phase 2 cleanup"


def test_schema_keeps_penalty():
    from bunking.config.schema import CONFIG_SCHEMA

    assert "constraint.cabin_minimum_occupancy.penalty" in CONFIG_SCHEMA, (
        "constraint.cabin_minimum_occupancy.penalty is the lone tunable knob in this domain and must stay in the schema"
    )


# Constraint module ------------------------------------------------------------


def test_cabin_occupancy_module_drops_enabled_gate():
    import bunking.solver.constraints.cabin_occupancy as mod

    src = inspect.getsource(mod)
    assert 'get_constraint("cabin_minimum_occupancy", "enabled"' not in src, (
        "cabin_occupancy.py must not read the deleted `enabled` key — the constraint always runs"
    )


def test_cabin_occupancy_module_drops_force_all_used_gate():
    import bunking.solver.constraints.cabin_occupancy as mod

    src = inspect.getsource(mod)
    assert 'get_constraint("cabin_minimum_occupancy", "force_all_used"' not in src, (
        "cabin_occupancy.py must not read the deleted `force_all_used` key — "
        "gender-qualification + force-bind always run"
    )


def test_cabin_occupancy_module_drops_preferred_direct_read():
    import bunking.solver.constraints.cabin_occupancy as mod

    src = inspect.getsource(mod)
    assert 'get_int("constraint.cabin_minimum_occupancy.preferred"' not in src, (
        "cabin_occupancy.py must read PREFERRED_BUNK_OCCUPANCY from bunking.solver.constants, not via config.get_int()"
    )


def test_cabin_occupancy_module_imports_occupancy_constants():
    """The module must import the new constants so the soft-penalty math is
    constant-driven, not config-driven. Identity-check the values against the
    canonical module to catch a local redefinition that drops the import."""
    import bunking.solver.constraints.cabin_occupancy as mod
    from bunking.solver import constants as solver_constants

    assert hasattr(mod, "MIN_BUNK_OCCUPANCY"), (
        "cabin_occupancy.py must import MIN_BUNK_OCCUPANCY from bunking.solver.constants"
    )
    assert hasattr(mod, "PREFERRED_BUNK_OCCUPANCY"), (
        "cabin_occupancy.py must import PREFERRED_BUNK_OCCUPANCY from bunking.solver.constants"
    )
    assert mod.MIN_BUNK_OCCUPANCY == solver_constants.MIN_BUNK_OCCUPANCY
    assert mod.PREFERRED_BUNK_OCCUPANCY == solver_constants.PREFERRED_BUNK_OCCUPANCY


# Centralized accessor ---------------------------------------------------------


def test_min_occupancy_threshold_returns_constant_ignoring_config(mock_config):
    """After hardcoding, the accessor returns the constant regardless of what's
    in the config (or whether the key is even present)."""
    from bunking.solver.constants import MIN_BUNK_OCCUPANCY
    from bunking.solver.penalties import min_occupancy_threshold

    # Plant a bogus value the old impl would have read.
    mock_config._config["constraint.cabin_minimum_occupancy.min"] = 999

    assert min_occupancy_threshold() == MIN_BUNK_OCCUPANCY


# Seed migration ---------------------------------------------------------------


def _seed_migration_text() -> str:
    here = Path(__file__).resolve()
    repo = here.parents[3]
    return (repo / "pocketbase" / "pb_migrations" / "1500000011_config.js").read_text()


def test_seed_migration_drops_deleted_keys_from_all_maps():
    """The four deleted keys must not appear anywhere in the seed migration:
    not in configDefinitions, FRIENDLY_NAMES, TOOLTIPS, SECTION_MAPPING, or
    fullKeyMappings.
    """
    text = _seed_migration_text()
    for deleted_key in (
        "constraint.cabin_minimum_occupancy.enabled",
        "constraint.cabin_minimum_occupancy.min",
        "constraint.cabin_minimum_occupancy.preferred",
        "constraint.cabin_minimum_occupancy.force_all_used",
    ):
        assert deleted_key not in text, (
            f"{deleted_key} must be removed from 1500000011_config.js — found stray reference"
        )


def test_seed_migration_keeps_penalty():
    text = _seed_migration_text()
    assert "constraint.cabin_minimum_occupancy.penalty" in text, (
        "constraint.cabin_minimum_occupancy.penalty must remain seeded as "
        "the lone tunable knob in the cabin-occupancy section"
    )
