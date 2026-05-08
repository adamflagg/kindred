"""Solver-domain hardcoded constants.

These values were previously stored in the PocketBase ``config`` collection
under ``constraint.cabin_capacity.{standard,max,mode,penalty}`` plus a
``max_size`` Pydantic default on the ``Bunk`` model. None were ever tuned at
runtime, and the Pydantic ``max_size`` was never backed by a real PB column —
it always returned 12 via the default.

Collapsing to two named constants:
- ``DEFAULT_BUNK_CAPACITY`` is the solver hard cap and the reference cabin size
  used by grade-ratio math and post-solve evaluators.
- ``MAX_BUNK_CAPACITY`` is the staff manual-edit ceiling, enforced by the
  drag-and-drop UI when staff bump a cabin to 13 or 14 by judgment call.

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
