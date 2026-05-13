"""Registry discipline: every hard-constraint module has a matching predicate."""

from __future__ import annotations

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
    "bunk_capacity",
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
