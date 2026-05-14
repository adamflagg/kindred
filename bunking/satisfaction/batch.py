"""Batch application of the per-request satisfaction predicate.

`satisfied_request_ids_by_person` is the post-solve counterpart to the
solve-time satisfaction vars: given a finished set of assignments, it walks
every request from an assigned requester and asks
`bunking.satisfaction.predicate.is_request_satisfied`
whether it landed. It exists so the solver's post-solve stats path
(`bunking/solver/direct_solver.py`) shares one satisfaction definition with
the CP-SAT model and `/api/satisfaction`, instead of re-deriving the
request-type branching itself.
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from bunking.logging_config import get_logger
from bunking.satisfaction.predicate import is_request_satisfied

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkAssignment, DirectBunkRequest, DirectPerson

logger = get_logger(__name__)


def satisfied_request_ids_by_person(
    assignments: list[DirectBunkAssignment],
    requests_by_person: dict[int, list[DirectBunkRequest]],
    person_by_cm_id: dict[int, DirectPerson],
) -> dict[int, list[str]]:
    """Return ``{requester_cm_id: [satisfied request id, ...]}`` for the assignments.

    Delegates per-request to `is_request_satisfied` — the canonical predicate
    shared with the CP-SAT model and `/api/satisfaction`. Requests with an
    unknown ``request_type``, or ``age_preference`` requests whose requester
    grade is outside 0-12, raise `ValueError` in the predicate; they are
    caught here and treated as unsatisfied (with a warning) so a single bad
    row cannot abort post-solve stats.

    Args:
        assignments: Finished bunk assignments.
        requests_by_person: Requester cm_id -> that camper's requests.
        person_by_cm_id: Person cm_id -> person. Read only for grade — required
            for age_preference requests; bunk_with / not_bunk_with tolerate
            absences (the predicate does not read grade for those types).

    Returns:
        Requester cm_id -> list of satisfied request ids. Requesters with no
        satisfied requests are absent from the dict.
    """
    person_to_bunk: dict[int, int] = {a.person_cm_id: a.bunk_cm_id for a in assignments}

    # Grades of every other camper sharing a bunk, keyed by requester cm_id.
    # Built once here rather than per age_preference request.
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)
    for person_cm_id, bunk_cm_id in person_to_bunk.items():
        bunk_to_persons[bunk_cm_id].append(person_cm_id)

    bunkmate_grades: dict[int, list[int]] = {}
    for person_cm_id, bunk_cm_id in person_to_bunk.items():
        grades: list[int] = []
        for mate_cm_id in bunk_to_persons[bunk_cm_id]:
            if mate_cm_id == person_cm_id:
                continue
            # Bunkmates absent from person_by_cm_id are excluded — no grade on file.
            mate = person_by_cm_id.get(mate_cm_id)
            if mate is not None:
                grades.append(mate.grade)
        bunkmate_grades[person_cm_id] = grades

    satisfied: dict[int, list[str]] = defaultdict(list)
    for person_cm_id, requests in requests_by_person.items():
        if person_cm_id not in person_to_bunk:
            continue
        requester = person_by_cm_id.get(person_cm_id)
        requester_grade = requester.grade if requester is not None else None
        for request in requests:
            request_mapping = {
                **request.model_dump(),
                "requester_grade": requester_grade,
            }
            try:
                is_satisfied = is_request_satisfied(
                    request_mapping,
                    person_to_bunk,
                    bunkmate_grades=bunkmate_grades,
                )
            except ValueError as exc:
                logger.warning(
                    "treating request as unsatisfied: %s (request_id=%s)",
                    exc,
                    request.id,
                )
                continue
            if is_satisfied:
                satisfied[person_cm_id].append(request.id)

    return dict(satisfied)
