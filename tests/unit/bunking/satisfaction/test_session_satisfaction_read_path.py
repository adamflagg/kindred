"""The PocketBase reads behind `/api/satisfaction` (camper page "X/Y met").

Three changes, each with no change to the response:

* The bunkmate grades come from the assignment's own `expand.person`, which
  the read already asks for. The separate chunked `persons` read ran AFTER the
  parallel pair, so it added sequential round trips for data already in hand.
  It stays only as a fallback for a person whose expanded record is from
  another year (the fetch it replaces was year-scoped).
* Both reads page at PocketBase's ceiling (1000) instead of the SDK default
  (100), and never with `skipTotal`: the SDK decides whether to fetch the next
  page from `totalItems`, which `skipTotal` makes -1, so it would silently stop
  after the first page.
* Both reads name the columns they use with `fields=`. The EQUIVALENCE test
  below serves wide rows once in full and once projected, and compares the
  whole response, which is what catches a column the list leaves out.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from pocketbase.models.record import Record

from api.constants.collections import BUNK_ASSIGNMENTS, BUNK_ASSIGNMENTS_DRAFT, BUNK_REQUESTS, PERSONS
from bunking.satisfaction.aggregate import session_satisfaction
from tests.fixtures.pb_projection import project

YEAR = 2026
SESSION = 999

ASSIGNMENT_FIELDS = {
    "id",
    "person",
    "bunk",
    "expand.person.cm_id",
    "expand.person.grade",
    "expand.person.year",
    "expand.bunk.cm_id",
}
REQUEST_FIELDS = {
    "id",
    "requester_id",
    "requestee_id",
    "request_type",
    "source_field",
    "age_preference_target",
}


def _person(cm_id: int, grade: int, year: int = YEAR) -> dict[str, Any]:
    """A WIDE persons row: the columns the read uses, plus noise."""
    return {
        "id": f"p{cm_id:014d}",
        "collectionName": "persons",
        "cm_id": cm_id,
        "grade": grade,
        "year": year,
        "first_name": "Emma",
        "last_name": "Johnson",
        "gender": "F",
        "age": 10.5,
        "school": "Riverside Elementary",
        "years_at_camp": 2,
    }


def _assignment(person: dict[str, Any], bunk_cm_id: int) -> dict[str, Any]:
    return {
        "id": f"a{person['cm_id']:014d}",
        "collectionName": "bunk_assignments",
        "cm_id": person["cm_id"] * 1000 + bunk_cm_id,
        "person": person["id"],
        "bunk": f"b{bunk_cm_id:014d}",
        "session": f"s{1:014d}",
        "year": YEAR,
        "is_deleted": False,
        "expand": {
            "person": person,
            "bunk": {"id": f"b{bunk_cm_id:014d}", "cm_id": bunk_cm_id, "name": f"B-{bunk_cm_id}", "year": YEAR},
        },
    }


def _request(rid: str, requester: int, requestee: int, request_type: str, source: str, **extra: Any) -> dict[str, Any]:
    return {
        "id": rid,
        "collectionName": "bunk_requests",
        "requester_id": requester,
        "requestee_id": requestee,
        "request_type": request_type,
        "source_field": source,
        "status": "resolved",
        "year": YEAR,
        "session_id": SESSION,
        "merged_into": "",
        "confidence_score": 0.9,
        "original_text": "wants to be with a friend",
        "age_preference_target": extra.pop("age_preference_target", ""),
        **extra,
    }


# Grades matter to the outcome: camper 1 (grade 5) wants older but bunks only
# with camper 2 (grade 4) -> unsatisfied; camper 3 (grade 5) wants older and
# bunks with camper 4 (grade 7) -> satisfied. With grades missing, BOTH read
# unsatisfied, so a lost grade shows up in the response.
P1, P2, P3, P4 = _person(1, 5), _person(2, 4), _person(3, 5), _person(4, 7)
ASSIGNMENTS = [_assignment(P1, 10), _assignment(P2, 10), _assignment(P3, 11), _assignment(P4, 11)]
REQUESTS = [
    _request("r_age1", 1, 0, "age_preference", "socialize_with", age_preference_target="older"),
    _request("r_age3", 3, 0, "age_preference", "socialize_with", age_preference_target="older"),
    _request("r_bw", 2, 1, "bunk_with", "bunk_request_form"),
    _request("r_nbw", 4, 3, "not_bunk_with", "staff_not_bunk_with"),
]


class _PB:
    """Serves fixed rows per collection, projected by each request's own
    `fields` unless `project` is False. Records every call's kwargs."""

    def __init__(self, rows: dict[str, list[dict[str, Any]]], *, project: bool = True) -> None:
        self._rows = rows
        self._project = project
        self.calls: dict[str, list[dict[str, Any]]] = {}

    def collection(self, name: str) -> MagicMock:
        coll = MagicMock()

        def get_full_list(batch: int = 100, query_params: dict[str, Any] | None = None) -> list[Record]:
            params = dict(query_params or {})
            self.calls.setdefault(name, []).append({"batch": batch, **params})
            fields = params.get("fields") if self._project else None
            return [Record(project(row, fields)) for row in self._rows.get(name, [])]

        coll.get_full_list.side_effect = get_full_list
        return coll


def _per_request(resp: Any) -> dict[str, bool]:
    return {pr.request_id: pr.satisfied for c in resp.campers.values() for pr in c.per_request}


def test_grades_come_from_expanded_person_without_a_persons_read() -> None:
    pb = _PB({BUNK_ASSIGNMENTS: ASSIGNMENTS, BUNK_REQUESTS: REQUESTS, PERSONS: [P1, P2, P3, P4]})

    resp = session_satisfaction([SESSION], YEAR, None, pb)

    assert PERSONS not in pb.calls, f"persons was read {len(pb.calls.get(PERSONS, []))} time(s)"
    assert _per_request(resp)["r_age1"] is False  # only bunkmate is younger
    assert _per_request(resp)["r_age3"] is True  # bunkmate is older


def test_expanded_person_from_another_year_falls_back_to_a_year_scoped_read() -> None:
    """The replaced read filtered `year = {year}`. If an assignment's person
    relation ever points at another year's row, that row's grade is not the
    one the old read would have used, so only that person is looked up."""
    stale_p4 = _person(4, 2, year=YEAR - 1)
    assignments = [_assignment(P1, 10), _assignment(P2, 10), _assignment(P3, 11), _assignment(stale_p4, 11)]
    pb = _PB({BUNK_ASSIGNMENTS: assignments, BUNK_REQUESTS: REQUESTS, PERSONS: [P4]})

    resp = session_satisfaction([SESSION], YEAR, None, pb)

    persons_filters = [call["filter"] for call in pb.calls.get(PERSONS, [])]
    assert len(persons_filters) == 1, persons_filters
    assert f"year = {YEAR}" in persons_filters[0]
    assert "cm_id = 4" in persons_filters[0]
    for other in (1, 2, 3):
        assert f"cm_id = {other} " not in persons_filters[0] + " "
    # Camper 4's grade is this year's 7, not last year's 2, so camper 3's "older" holds.
    assert _per_request(resp)["r_age3"] is True


def test_reads_page_at_the_ceiling_with_a_projection_and_no_skip_total() -> None:
    for scenario, collection in ((None, BUNK_ASSIGNMENTS), ("scenarioabc1234", BUNK_ASSIGNMENTS_DRAFT)):
        pb = _PB({collection: ASSIGNMENTS, BUNK_REQUESTS: REQUESTS})
        session_satisfaction([SESSION], YEAR, scenario, pb)

        for name, expected_fields in ((collection, ASSIGNMENT_FIELDS), (BUNK_REQUESTS, REQUEST_FIELDS)):
            (call,) = pb.calls[name]
            assert call["batch"] == 1000, f"{name} paged at {call['batch']}"
            assert "skipTotal" not in call, f"{name} sent skipTotal, which stops get_full_list after one page"
            sent = [f.strip() for f in call.get("fields", "").split(",") if f.strip()]
            assert set(sent) == expected_fields, f"{name} fields={call.get('fields')!r}"


def test_projected_reads_produce_the_same_response_as_full_rows() -> None:
    for scenario, collection in ((None, BUNK_ASSIGNMENTS), ("scenarioabc1234", BUNK_ASSIGNMENTS_DRAFT)):
        rows = {collection: ASSIGNMENTS, BUNK_REQUESTS: REQUESTS, PERSONS: [P1, P2, P3, P4]}
        full = session_satisfaction([SESSION], YEAR, scenario, _PB(rows, project=False))
        projected = session_satisfaction([SESSION], YEAR, scenario, _PB(rows, project=True))

        assert projected.model_dump() == full.model_dump()
        # And the fixture is one where a lost column would show.
        assert _per_request(full)["r_age3"] is True
