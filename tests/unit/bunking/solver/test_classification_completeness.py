"""Golden-rule: every HARD constraint module is classified in exactly one tier.

A hard constraint module is one under bunking/solver/constraints/ whose builder
issues model.Add(...) as an inviolable constraint AND exposes a debug-disable
hook via ctx.is_constraint_disabled("<name>"). This test fails loudly if a new
hard constraint is added without classifying it — the gap that let grade_adjacency
ship unclassified in Stream C.
"""

from bunking.solver.constraint_classification import ALL_HARD_CONSTRAINTS

# Explicit, human-curated cross-check of the real hard constraints the solver
# can issue. This pins the registry to a name we have eyeballed against the
# constraints package — `test_every_hard_constraint_is_classified` asserts it
# equals ALL_HARD_CONSTRAINTS, so a typo or accidental addition on either side
# trips the test rather than silently drifting.
EXPECTED_HARD_DISABLE_KEYS = frozenset(
    {
        "gender",
        "session_boundary",
        "cabin_capacity",
        "grade_spread",
        "grade_adjacency",
        "age_spread",
        "group_locks",
        "parent_paramount",
        "staff_separation",
    }
)


class TestClassificationCompleteness:
    def test_every_hard_constraint_is_classified(self):
        """ALL_HARD_CONSTRAINTS must equal the set of real hard-disable keys."""
        assert ALL_HARD_CONSTRAINTS == EXPECTED_HARD_DISABLE_KEYS

    def test_no_hard_constraint_module_is_unclassified(self):
        """Scan the constraints package for is_constraint_disabled('<name>')
        calls in hard-constraint modules; every name must be classified, and
        every classified name must have a backing module/hook.

        Catches both failure modes:
          * forward — a new module adds a debug-disable hook but forgets to
            classify the constraint (would land in ``found`` but not the registry);
          * reverse — a phantom name added to the registry with no backing
            module/hook (would land in the registry but never in ``found``)."""
        import re
        from pathlib import Path

        import bunking.solver.constraints as pkg

        # Soft-only modules legitimately call is_constraint_disabled but never
        # issue an inviolable model.Add — excluded from the hard registry.
        # level_progression: penalty-based regression soft constraint only.
        # grade_ratio: soft constraint penalizing single-grade dominance, never
        #              issues an unconditional hard model.Add (Stream #1695).
        SOFT_ONLY = {"level_progression", "grade_ratio"}

        # Hard constraints that have NO is_constraint_disabled hook, so the scan
        # below can't see them: session_boundary is enforced via the
        # impossibility registry (pre-solve), and cabin_capacity via an
        # unconditional model.Add. They are still real and classified, so the
        # reverse check must exempt them.
        NO_HOOK_HARD = {"session_boundary", "cabin_capacity"}

        constraints_dir = Path(pkg.__file__).parent
        found: set[str] = set()
        pattern = re.compile(r'is_constraint_disabled\(\s*["\']([a-z_]+)["\']')
        for py in constraints_dir.glob("*.py"):
            for name in pattern.findall(py.read_text()):
                if name not in SOFT_ONLY:
                    found.add(name)

        # Forward: every scanned hard hook must be classified.
        unclassified = found - ALL_HARD_CONSTRAINTS
        assert not unclassified, f"Unclassified hard constraints: {sorted(unclassified)}"

        # Reverse: every classified name must be backed by a real module/hook
        # (or be one of the known no-hook hard constraints).
        phantom = ALL_HARD_CONSTRAINTS - found - NO_HOOK_HARD
        assert not phantom, f"Classified names with no backing constraint module/hook: {sorted(phantom)}"
