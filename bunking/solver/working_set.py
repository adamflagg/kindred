"""Reduce a DirectSolverInput to its unlocked "working set" before the solver builds
its CP-SAT model.

Approach
--------
Rather than pinning locked-cabin occupants inside the model (the old "pin and
skip" approach), we *remove* them from the input entirely.  The CP-SAT model
therefore never sees frozen persons or their bunks, so every constraint is
automatically scoped to the unlocked world.

The caller receives a WorkingSetReduction that contains:

* ``reduced_input``  – a copy of the input with only working (unlocked)
  persons/bunks and the narrowed request list.
* ``frozen_assignments`` – pre-built DirectBunkAssignment rows for every
  occupant of every locked bunk; the caller merges these into the solver
  output alongside the new assignments.
* ``cross_boundary_request_ids`` – IDs of bunk_with requests that cross the
  locked/working boundary and cannot be satisfied by the freeze; the caller
  may surface these in the UI as advisory warnings.

Tasks 2 and 3 (partition + request narrowing) are gated on ``inp.locked_bunks``
being non-empty, so an empty map always produces an identity result.
"""

from dataclasses import dataclass, field

from bunking.models_v2 import DirectBunkAssignment, DirectSolverInput
from campminder.client import get_current_season


@dataclass(frozen=True)
class WorkingSetReduction:
    """Immutable result of reducing a DirectSolverInput to its working set."""

    reduced_input: DirectSolverInput
    frozen_assignments: list[DirectBunkAssignment] = field(default_factory=list)
    cross_boundary_request_ids: list[str] = field(default_factory=list)


def reduce_to_working_set(inp: DirectSolverInput) -> WorkingSetReduction:
    """Return a WorkingSetReduction that scopes the input to unlocked persons/bunks.

    When ``inp.locked_bunks`` is empty the call is a no-op (identity): the
    original input is returned unchanged with empty frozen/cross-boundary lists.
    """
    if not inp.locked_bunks:
        return WorkingSetReduction(
            reduced_input=inp,
            frozen_assignments=[],
            cross_boundary_request_ids=[],
        )

    # ------------------------------------------------------------------
    # Task 2: partition frozen vs working persons/bunks
    # ------------------------------------------------------------------
    frozen_bunk_cms: set[int] = set(inp.locked_bunks)
    frozen_person_cms: set[int] = {cm for occupants in inp.locked_bunks.values() for cm in occupants}
    # Map each frozen person → which locked bunk they're in (for same-cabin check).
    frozen_bunk_by_person: dict[int, int] = {
        cm: bunk_cm for bunk_cm, occupants in inp.locked_bunks.items() for cm in occupants
    }

    working_bunks = [b for b in inp.bunks if b.campminder_id not in frozen_bunk_cms]
    working_persons = [p for p in inp.persons if p.campminder_person_id not in frozen_person_cms]

    year = get_current_season()
    frozen_assignments: list[DirectBunkAssignment] = []
    for bunk_cm, occupants in inp.locked_bunks.items():
        # Resolve the session for this bunk from the bunk object itself.
        bunk_obj = next((b for b in inp.bunks if b.campminder_id == bunk_cm), None)
        session_cm_id = bunk_obj.session_cm_id if bunk_obj else inp.persons[0].session_cm_id
        frozen_assignments.extend(
            DirectBunkAssignment(
                person_cm_id=person_cm,
                session_cm_id=session_cm_id,
                bunk_cm_id=bunk_cm,
                year=year,
            )
            for person_cm in occupants
        )

    # ------------------------------------------------------------------
    # Task 3: narrow requests + capture cross-boundary
    # ------------------------------------------------------------------
    working_requests = []
    cross_boundary_request_ids: list[str] = []

    for r in inp.requests:
        a = r.requester_person_cm_id
        b = r.requested_person_cm_id
        a_frozen = a in frozen_person_cms
        b_frozen = b is not None and b in frozen_person_cms

        if not a_frozen and not b_frozen:
            # Both working — keep as-is.
            working_requests.append(r)
            continue

        # At least one party is frozen → request leaves the model.
        if r.request_type == "bunk_with" and b is not None:
            # Determine whether both are frozen in the *same* locked cabin
            # (satisfied by the freeze) or in different ones / only one frozen.
            same_locked_cabin = a_frozen and b_frozen and frozen_bunk_by_person.get(a) == frozen_bunk_by_person.get(b)
            if not same_locked_cabin:
                cross_boundary_request_ids.append(r.id)
        # not_bunk_with or malformed: drop silently (no cross-boundary flag).

    reduced = inp.model_copy(
        update={
            "persons": working_persons,
            "bunks": working_bunks,
            "requests": working_requests,
            "locked_bunks": {},
        }
    )

    return WorkingSetReduction(
        reduced_input=reduced,
        frozen_assignments=frozen_assignments,
        cross_boundary_request_ids=cross_boundary_request_ids,
    )
