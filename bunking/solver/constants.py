"""Solver-domain hardcoded constants.

Cabin capacity (PR #1226): collapsed from ``constraint.cabin_capacity.{standard,
max,mode,penalty}`` + a ``Bunk.max_size`` Pydantic default into the two
constants below. None were ever tuned at runtime, and ``max_size`` was never
backed by a real PB column.

Cabin minimum occupancy (PR #1331): collapsed from
``constraint.cabin_minimum_occupancy.{enabled,min,preferred,force_all_used}``
into the two constants below. The constraint always runs (staff invariant —
never fewer than ~8 campers per bunk), so the ``enabled`` and
``force_all_used`` knobs were dead toggles; ``min`` and ``preferred`` were
never tuned at runtime. ``constraint.cabin_minimum_occupancy.penalty`` is
KEPT in the config as the lone tunable knob.

Grade spread (Phase 2): collapsed from ``spread.max_grade`` (sync-side filter),
phantom ``constraint.grade_spread.max_spread`` (solver + evaluator reads, never
seeded), ``constraint.grade_spread.mode`` (seeded "soft" but production runs
"hard" via admin GUI override), ``constraint.grade_spread.penalty`` (soft path
never fired in observed solver logs), and the validator's parallel hardcode
into the single constant below. Solver is hard-only.

Age spread (Phase 2): collapsed phantom ``constraint.age_spread.months`` (read
with ``default=24``, never in CONFIG_SCHEMA), ``spread.max_age_months`` PB
config row (was only consumed by the sync-time spread filter; silently
disconnected from solver behavior), ``constraint.age_spread.penalty`` (soft
violation path being deleted), ``constraint.age_spread.preferred_months``
(seed=12, bumped to 18 here per staff intent), the validator's parallel
hardcoded ``24``, and the orphan ``DEFAULT_AGE_SPREAD_MONTHS`` in
``bunking/sync/.../core/constants.py`` into the three constants below
(``MAX_AGE_SPREAD_MONTHS``, ``PREFERRED_AGE_SPREAD_MONTHS``,
``EDGE_AGE_OVERFLOW_PENALTY``). Middle bunks treat the cap as hard;
edge bunks (lowest/highest level per gender+session) get a soft escape
hatch via ``EDGE_AGE_OVERFLOW_PENALTY`` so a hard MSO chain into the top
cabin remains feasible. ``constraint.age_spread.preferred_bonus`` is KEPT
in the config as the lone tunable knob in this domain.

If per-bunk variance is ever needed (e.g., a smaller specialty cabin), add a
real ``max_size`` integer column on the ``bunks`` PocketBase collection with a
sync path that populates it. That's a feature, not a refactor.
"""

from __future__ import annotations

DEFAULT_BUNK_CAPACITY = 12
"""Solver hard cap per bunk; also the reference cabin size for grade-ratio
math and post-solve evaluator displays."""

MAX_BUNK_CAPACITY = 14
"""Absolute ceiling enforced by the staff drag-and-drop UI. Solver does not
read this — it caps at ``DEFAULT_BUNK_CAPACITY``. Staff judgment calls to put
a 13th or 14th camper in a cabin happen post-solve in the assignments
editor."""

MIN_BUNK_OCCUPANCY = 8
"""Hard floor: a used (non-AG) bunk must have at least this many campers.
The solver enforces this as a hard constraint; staff never put fewer than
~8 campers in a cabin."""

PREFERRED_BUNK_OCCUPANCY = 10
"""Soft target: the under-fill penalty (configured weight) is charged per
spot below this threshold for used non-AG bunks. The OR-Tools cost path
and the two post-solve evaluators all read the same constant to keep the
displayed score in sync with what the solver actually optimized (B5 fix)."""

MAX_UNIQUE_GRADES_PER_BUNK = 2
"""Hard ceiling on distinct grades per non-AG bunk. Solver never emits a bunk
with more than this many unique grades; adjacency (consecutive grades only) is
enforced separately by ``grade_adjacency``. Staff can override on the bunking
board — the board flags the result with a ``grade_spread_warning`` issue type.
Reads:

- ``bunking/solver/constraints/grade_spread.py`` — hard CP-SAT constraint.
- ``bunking/solver/constraints/grade_spread.py:GradeCompatibilityImpossibility``
  — pre-flight pair impossibility detector.
- ``bunking/bunking_validator.py`` — board-side warning when staff manual
  overrides exceed the limit.
- ``bunking/sync/bunk_request_processor/orchestrator/orchestrator.py`` — sync-
  time spread filter on incoming bunk requests (was reading ``spread.max_grade``
  which is gone)."""

MAX_AGE_SPREAD_MONTHS = 24
"""Ceiling for age range (months) within a non-AG bunk. Enforced as a hard
CP-SAT constraint for middle bunks (the solver is INFEASIBLE if a middle bunk
exceeds it); for edge bunks (lowest/highest level per gender+session) the
solver may exceed it by paying ``EDGE_AGE_OVERFLOW_PENALTY`` — fires only
when a hard constraint (MSO chain, locked group) forces it. Staff can
override on the bunking board — the board allows >24mo with a display warning
(same asymmetry as ``MAX_BUNK_CAPACITY`` / ``MAX_UNIQUE_GRADES_PER_BUNK``).
Reads:

- ``bunking/solver/constraints/age_spread.py`` — hard CP-SAT constraint
  (middle bunks) + soft edge escape hatch.
- ``bunking/solver/feasibility.py:_explain_age_spread_infeasibility`` — when
  the hard cap causes INFEASIBLE, surfaces a staff-actionable message.
- ``bunking/bunking_validator.py`` — board-side warning when staff manual
  overrides exceed the limit.
- ``bunking/sync/bunk_request_processor/orchestrator/orchestrator.py`` — sync-
  time spread filter on incoming bunk requests."""

PREFERRED_AGE_SPREAD_MONTHS = 18
"""Soft target: bunks with spread <= ``PREFERRED_AGE_SPREAD_MONTHS`` earn a
tunable objective bonus (``constraint.age_spread.preferred_bonus``, kept as a
runtime knob). Bumped from the prior seed of 12 per staff intent — tighter
clusters that approximate single-grade cabins are the goal, but the prior
12-month target was too aggressive in practice."""

EDGE_AGE_OVERFLOW_PENALTY = 15_000
"""Penalty charged when an edge bunk (lowest or highest level for its gender/session)
exceeds MAX_AGE_SPREAD_MONTHS. Not exposed as a config knob — fires only when a hard
constraint (MSO, locked group) leaves no other option. Set above the typical soft-objective
gains the solver would otherwise chase (bunk-with weights are in the hundreds to low
thousands), so overflow never happens for non-structural reasons."""
