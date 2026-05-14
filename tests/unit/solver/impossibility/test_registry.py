"""Registry discipline: every hard-constraint module has a matching predicate."""

from __future__ import annotations

import subprocess
import sys

from bunking.solver.impossibility import HARD_CONSTRAINT_REGISTRY, HardConstraintImpossibility

# Names every constraint module that owns a hard-constraint variant.
# When a new hard constraint is added, add the expected predicate name here.
# This is the "registry discipline" check.
EXPECTED_HARD_PREDICATES = {
    "session_boundary",
    "gender",
    "malformed",
    "age_preference",
    "grade_compatibility",
}


def test_registry_is_non_empty():
    assert len(HARD_CONSTRAINT_REGISTRY) > 0, "HARD_CONSTRAINT_REGISTRY is empty; constraint modules failed to register"


def test_registry_covers_all_expected_predicates():
    registered_names = {p.name for p in HARD_CONSTRAINT_REGISTRY}
    missing = EXPECTED_HARD_PREDICATES - registered_names
    assert not missing, f"Missing predicates: {missing}. Registered: {registered_names}"


def test_all_predicates_inherit_base_class():
    for predicate in HARD_CONSTRAINT_REGISTRY:
        assert isinstance(predicate, HardConstraintImpossibility), (
            f"{type(predicate).__name__} must subclass HardConstraintImpossibility"
        )


def test_no_duplicate_predicate_names():
    names = [p.name for p in HARD_CONSTRAINT_REGISTRY]
    assert len(names) == len(set(names)), f"Duplicate predicate names: {names}"


def test_impossibility_module_alone_registers_all_predicates():
    # The in-process registry can be polluted by other test files that import
    # constraint modules as a side-effect of collection. Spawn a fresh
    # interpreter that imports ONLY bunking.solver.impossibility and verify it
    # bootstraps every expected predicate on its own — i.e. production paths
    # like the pre-validate endpoint don't depend on test-collection order.
    script = (
        "import bunking.solver.impossibility as m; print(','.join(sorted(p.name for p in m.HARD_CONSTRAINT_REGISTRY)))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=True,
    )
    registered = set(result.stdout.strip().split(","))
    missing = EXPECTED_HARD_PREDICATES - registered
    assert not missing, (
        f"Importing bunking.solver.impossibility alone left predicates unregistered: "
        f"{missing}. Registered: {registered}. "
        f"This means production callers (e.g. the pre-validate endpoint) would "
        f"silently skip those checks."
    )
