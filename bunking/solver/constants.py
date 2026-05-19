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
