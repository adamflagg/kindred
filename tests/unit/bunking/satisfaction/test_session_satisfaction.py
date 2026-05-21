"""Integration tests for bunking.satisfaction.aggregate.session_satisfaction.

Uses a mocked PocketBase client so tests are pure (no IO).
"""

from typing import Any
from unittest.mock import MagicMock

import pytest

from api.constants.collections import BUNK_ASSIGNMENTS, BUNK_ASSIGNMENTS_DRAFT, BUNK_REQUESTS, PERSONS
from bunking.satisfaction.aggregate import session_satisfaction
from bunking.satisfaction.api_shape import SatisfactionResponse
from bunking.satisfaction.bucket import RequestBucket


def _person(cm_id: int, grade: int = 10, gender: str = "M") -> Any:
    p = MagicMock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    return p


def _assignment(person_cm_id: int, bunk_cm_id: int) -> Any:
    """Build a bunk_assignments record shaped like the real PocketBase SDK returns.

    person/bunk are relation fields (PB record ids); cm_ids resolve via the expand
    payload (#1171). NEVER add flat person_cm_id/bunk_cm_id attributes — the real
    schema doesn't have them and tests must mirror that.
    """
    from types import SimpleNamespace

    return SimpleNamespace(
        id=f"a{person_cm_id:014d}",
        cm_id=person_cm_id * 1000 + bunk_cm_id,
        person=f"p{person_cm_id:014d}",
        bunk=f"b{bunk_cm_id:014d}",
        session=f"s{1:014d}",
        expand={
            "person": SimpleNamespace(
                id=f"p{person_cm_id:014d}",
                cm_id=person_cm_id,
            ),
            "bunk": SimpleNamespace(
                id=f"b{bunk_cm_id:014d}",
                cm_id=bunk_cm_id,
            ),
        },
    )


def _build_pb_mock(
    persons: list[Any],
    assignments: list[Any],
    requests: list[dict[str, Any]],
    draft_assignments: list[Any] | None = None,
) -> MagicMock:
    _draft = draft_assignments if draft_assignments is not None else []

    def collection(name: str) -> Any:
        col = MagicMock()
        if name == PERSONS:
            col.get_full_list.return_value = persons
        elif name == BUNK_ASSIGNMENTS:
            col.get_full_list.return_value = assignments
        elif name == BUNK_ASSIGNMENTS_DRAFT:
            col.get_full_list.return_value = _draft
        elif name == BUNK_REQUESTS:
            col.get_full_list.return_value = requests
        else:
            raise AssertionError(f"unexpected collection: {name}")
        return col

    pb = MagicMock()
    pb.collection.side_effect = collection
    return pb


class TestSessionSatisfactionProductionPath:
    @pytest.fixture
    def pb_with_data(self) -> MagicMock:
        persons = [_person(1, 10), _person(2, 10), _person(3, 10)]
        assignments = [
            _assignment(1, 100),
            _assignment(2, 100),
            _assignment(3, 101),
        ]
        # 1 → 2 satisfied (same bunk); 1 → 3 unsatisfied (different bunk)
        requests = [
            {
                "id": "r1",
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": "bunk_request_form",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            {
                "id": "r2",
                "requester_id": 1,
                "requestee_id": 3,
                "request_type": "bunk_with",
                "source_field": "bunk_request_form",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
        ]
        return _build_pb_mock(persons, assignments, requests)

    def test_returns_typed_response(self, pb_with_data: MagicMock) -> None:
        resp = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb_with_data)
        assert isinstance(resp, SatisfactionResponse)
        assert resp.session_cm_id == 999
        assert resp.year == 2026
        assert resp.scenario_id is None

    def test_aggregates_each_camper_with_requests(self, pb_with_data: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_with_data)
        # Camper 1 has 2 requests in this fixture
        assert 1 in resp.campers
        camper1 = resp.campers[1]
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].total == 2
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1


class TestSessionSatisfactionScenarioPath:
    def test_scenario_id_routes_to_draft_collection(self) -> None:
        persons = [_person(1)]
        assignments = [_assignment(1, 100)]
        requests: list[dict[str, Any]] = []
        pb = _build_pb_mock(persons, assignments, requests)

        # Use a structurally valid 15-char alphanumeric scenario_id (PB record-id shape).
        valid_scenario = "scenarioabc1234"
        resp = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=valid_scenario, pb_client=pb)

        assert resp.scenario_id == valid_scenario
        # Verify routing: draft collection was queried, prod was not.
        called_collections = [call.args[0] for call in pb.collection.call_args_list]
        assert BUNK_ASSIGNMENTS_DRAFT in called_collections
        assert BUNK_ASSIGNMENTS not in called_collections


class TestMultiSession:
    """Widened signature: session_cm_ids accepts multiple ids for AG clusters."""

    def test_multi_session_filter_strings_contain_both_ids(self) -> None:
        """Filters passed to PB must include both session ids when a cluster is requested."""
        tracked_filters: list[str] = []

        # Build tracked mock collections without recursive side_effect calls.
        def _make_col(name: str) -> MagicMock:
            col = MagicMock()

            def _get_full_list(**kwargs: Any) -> list[Any]:
                # Tolerate both `query_params={"filter": ...}` (canonical PB SDK) and
                # bare `filter=...` (legacy). Finding #30 — capture from either shape.
                qp = kwargs.get("query_params") or {}
                tracked_filters.append(qp.get("filter") or kwargs.get("filter", ""))
                if "person" in name.lower():
                    return [_person(1)]
                if "draft" in name.lower():
                    return []
                if "assignment" in name.lower():
                    return [_assignment(1, 100)]
                if "request" in name.lower():
                    return []
                return []

            col.get_full_list.side_effect = _get_full_list
            return col

        pb = MagicMock()
        pb.collection.side_effect = _make_col

        resp = session_satisfaction(
            session_cm_ids=[999, 998],
            year=2026,
            scenario_id=None,
            pb_client=pb,
        )

        # Primary session is reported in response
        assert resp.session_cm_id == 999

        # Verify both session ids appear in assignment and request filters
        assignment_filter = next(f for f in tracked_filters if "session.cm_id" in f)
        request_filter = next(f for f in tracked_filters if "session_id = 999" in f)

        assert "session.cm_id = 999" in assignment_filter
        assert "session.cm_id = 998" in assignment_filter
        assert "session_id = 999" in request_filter
        assert "session_id = 998" in request_filter

    def test_empty_session_cm_ids_raises(self) -> None:
        pb = _build_pb_mock([], [], [])
        with pytest.raises(ValueError, match="session_cm_ids must contain at least one id"):
            session_satisfaction(session_cm_ids=[], year=2026, scenario_id=None, pb_client=pb)

    def test_non_int_year_rejected_before_any_pb_query(self) -> None:
        """Scan-it round 3 #14: year is interpolated into PB filter strings
        without validation. Router validates with ge/le, but session_satisfaction
        is callable directly by tests/scripts (mirrors the existing scenario_id
        defense-in-depth at lines 202-203).

        Defense-in-depth must reject BEFORE any pb_client.collection() call so
        a malformed filter string never reaches PocketBase.
        """
        pb = _build_pb_mock([], [], [])
        with pytest.raises((ValueError, TypeError), match="year"):
            session_satisfaction(
                session_cm_ids=[999],
                year="2026'; DROP TABLE bunk_assignments; --",  # type: ignore[arg-type]
                scenario_id=None,
                pb_client=pb,
            )
        # Verify no PB queries were issued — validation fires first.
        pb.collection.assert_not_called()


class TestMalformedRowSkipped:
    """Scan-it round 3 #1: a row missing requester_id raised KeyError in
    _coerce_row, which propagated up and 500'd the whole /api/satisfaction
    response. Per the docstring contract ("one malformed row should not 500
    the whole call"), the bad row must be logged and skipped while good
    rows in the same response are still processed.
    """

    def test_row_missing_requester_id_skipped_good_rows_succeed(self) -> None:
        persons = [_person(1, 10), _person(2, 10)]
        assignments = [_assignment(1, 100), _assignment(2, 100)]
        good_request = {
            "id": "r_good",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
            "year": 2026,
            "session_id": 999,
            "merged_into": "",
        }
        bad_request = {
            "id": "r_bad",
            # requester_id absent — legacy row / schema regression
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
            "year": 2026,
            "session_id": 999,
            "merged_into": "",
        }
        pb = _build_pb_mock(persons, assignments, [good_request, bad_request])

        # Must not raise — bad row is skipped, good row is processed.
        resp = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb)

        # Good row's bucket survives
        assert 1 in resp.campers
        camper1 = resp.campers[1]
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].total == 1
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1


class TestAllRequestTypeVariants:
    """Verify each (request_type, source_field) combination lands in the right bucket.

    Persons: 1 in bunk 100; 2 in bunk 100; 3 in bunk 101.
    Truth table:
      r_bunk_parent:   1 bunk_with 2, source_field=bunk_with         → MATERIAL_PARENT, satisfied
      r_bunk_staff:    1 bunk_with 3, source_field=bunking_notes     → STAFF, unsatisfied
      r_not_bunk:      2 not_bunk_with 1, source_field=not_bunk_with → STAFF, unsatisfied (same bunk)
      r_socialize:     2 bunk_with 3, source_field=socialize_with    → IMMATERIAL_PARENT
      r_internal:      3 bunk_with 1, source_field=internal_notes    → STAFF, unsatisfied (different bunks)
      r_age:           3 age_preference, source_field=socialize_with → IMMATERIAL_PARENT (canonical
                       pairing — production age_preference rows always carry the socialize_with
                       parent dropdown source per bunk_request_processor convention)
    """

    @pytest.fixture
    def pb_all_variants(self) -> MagicMock:
        persons = [_person(1, 10), _person(2, 10), _person(3, 10)]
        assignments = [_assignment(1, 100), _assignment(2, 100), _assignment(3, 101)]
        requests = [
            # bunk_with parent → MATERIAL_PARENT; 1→2 same bunk = satisfied
            {
                "id": "r_bunk_parent",
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": "bunk_request_form",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            # bunk_with staff (bunking_notes) → STAFF; 1→3 different bunks = unsatisfied
            {
                "id": "r_bunk_staff",
                "requester_id": 1,
                "requestee_id": 3,
                "request_type": "bunk_with",
                "source_field": "bunking_notes",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            # not_bunk_with → STAFF; 2→1 same bunk = unsatisfied (violation)
            {
                "id": "r_not_bunk",
                "requester_id": 2,
                "requestee_id": 1,
                "request_type": "not_bunk_with",
                "source_field": "staff_not_bunk_with",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            # socialize_with → IMMATERIAL_PARENT; 2→3 different bunks (irrelevant for immaterial)
            {
                "id": "r_socialize",
                "requester_id": 2,
                "requestee_id": 3,
                "request_type": "bunk_with",
                "source_field": "socialize_with",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            # internal_notes → STAFF; 3→1 different bunks = unsatisfied (bunk_with not met)
            {
                "id": "r_internal",
                "requester_id": 3,
                "requestee_id": 1,
                "request_type": "bunk_with",
                "source_field": "internal_notes",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
            # age_preference / socialize_with → IMMATERIAL_PARENT; classified by source_field,
            # not request_type. Production age_preference rows go through socialize_with.
            {
                "id": "r_age",
                "requester_id": 3,
                "requestee_id": 0,
                "request_type": "age_preference",
                "source_field": "socialize_with",
                "age_preference_target": "older",
                "year": 2026,
                "session_id": 999,
                "merged_into": "",
            },
        ]
        return _build_pb_mock(persons, assignments, requests)

    def test_bunk_with_parent_lands_in_material_parent_bucket(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper1 = resp.campers[1]
        # r_bunk_parent (bunk_with/bunk_with) → MATERIAL_PARENT satisfied
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].total == 1
        assert camper1.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1

    def test_staff_sourced_bunk_with_lands_in_staff_bucket(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper1 = resp.campers[1]
        # r_bunk_staff (bunk_with/bunking_notes) → STAFF unsatisfied (1→3 diff bunks)
        # NOTE: bunk_with request type but bunking_notes source_field → STAFF bucket
        assert camper1.counted_totals[RequestBucket.STAFF].total == 1
        assert camper1.counted_totals[RequestBucket.STAFF].satisfied == 0

    def test_not_bunk_with_lands_in_staff_bucket(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper2 = resp.campers[2]
        # r_not_bunk: 2→1 same bunk = violation (unsatisfied)
        assert camper2.counted_totals[RequestBucket.STAFF].total == 1
        assert camper2.counted_totals[RequestBucket.STAFF].satisfied == 0

    def test_socialize_with_lands_in_immaterial_bucket(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper2 = resp.campers[2]
        # r_socialize (bunk_with/socialize_with) → IMMATERIAL — not counted in totals
        assert camper2.immaterial.total == 1
        assert camper2.counted_totals[RequestBucket.MATERIAL_PARENT].total == 0

    def test_internal_notes_lands_in_staff_bucket(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper3 = resp.campers[3]
        # r_internal: 3 bunk_with 1 via internal_notes → STAFF; 3 in bunk 101, 1 in bunk 100
        # Different bunks = bunk_with NOT satisfied
        assert camper3.counted_totals[RequestBucket.STAFF].total == 1
        assert camper3.counted_totals[RequestBucket.STAFF].satisfied == 0

    def test_age_preference_with_socialize_with_source_lands_in_immaterial(self, pb_all_variants: MagicMock) -> None:
        resp = session_satisfaction([999], 2026, None, pb_all_variants)
        camper3 = resp.campers[3]
        # r_age: age_preference request_type, source_field=socialize_with → IMMATERIAL.
        # Camper 3 also has r_internal (STAFF), so MATERIAL_PARENT total is 0 and
        # immaterial.total is 1 (just r_age).
        assert camper3.immaterial.total == 1
        assert camper3.counted_totals[RequestBucket.MATERIAL_PARENT].total == 0


def test_assignment_with_zero_bunk_cm_id_is_filtered() -> None:
    """Assignments with bunk_cm_id <= 0 are silently skipped (not inserted into person_to_bunk)."""
    persons = [_person(1, 10), _person(2, 10)]
    # Person 1 has a pathological assignment (bunk_cm_id=0); person 2 has a valid one.
    bad_assignment = _assignment(1, 0)
    good_assignment = _assignment(2, 100)
    requests: list[dict[str, Any]] = []
    pb = _build_pb_mock(persons, [bad_assignment, good_assignment], requests)
    response = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb)
    # Camper 2 is present (valid assignment); camper 1 is absent (filtered).
    assert 2 in response.campers
    assert 1 not in response.campers


def test_campers_includes_assigned_with_zero_requests() -> None:
    """Regression: assigned campers with no requests must appear with no_requests status."""
    # Camper 1 has a request; camper 2 is assigned but silent.
    persons = [_person(1, 10), _person(2, 10)]
    assignments = [_assignment(1, 100), _assignment(2, 100)]
    requests = [
        {
            "id": "r1",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
            "year": 2026,
            "session_id": 999,
            "merged_into": "",
        }
    ]
    pb = _build_pb_mock(persons, assignments, requests)
    response = session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb)
    assert 1 in response.campers
    assert 2 in response.campers  # camper 2 has no requests but is assigned
    assert response.campers[2].flags.has_any_counted_request is False


def test_unknown_source_field_raises_on_classify() -> None:
    """bucket.classify_request raises on any source_field not in _BUCKET_MAP.

    The PB schema requires source_field, and the bucket map covers every legal
    value. Any unknown source_field is a data-hygiene regression and must
    surface loudly rather than be silently misbucketed.
    """
    persons = [_person(1, 10)]
    assignments = [_assignment(1, 100)]
    requests = [
        {
            "id": "r_bogus",
            "requester_id": 1,
            "requestee_id": 0,
            "request_type": "bunk_with",
            "source_field": "made_up_source",
            "year": 2026,
            "session_id": 999,
            "merged_into": "",
        }
    ]
    pb = _build_pb_mock(persons, assignments, requests)
    with pytest.raises(ValueError, match="unknown source_field"):
        session_satisfaction([999], 2026, None, pb)


# ---------------------------------------------------------------------------
# Task 34 — Persons fetch scoped to assigned cm_ids
# ---------------------------------------------------------------------------


def test_session_satisfaction_scopes_persons_fetch_to_assigned() -> None:
    """Persons fetch must reference only the cm_ids present in bunk assignments.

    Previously the filter was the broad ``year = {year}`` which scanned all
    persons in the year.  After Task 34 the filter must contain the specific
    cm_ids that appear in the assignment list, not a year-wide scan.
    """
    captured_filters: list[str] = []

    def make_collection(name: str) -> Any:
        col = MagicMock()
        if name == PERSONS:

            def capture(*_args: Any, **kwargs: Any) -> list[Any]:
                # Accept both `query_params={"filter": ...}` and legacy `filter=...`.
                qp = kwargs.get("query_params") or {}
                captured_filters.append(qp.get("filter") or kwargs.get("filter", ""))
                return []

            col.get_full_list.side_effect = capture
        elif name == BUNK_ASSIGNMENTS:
            col.get_full_list.return_value = [_assignment(1, 10), _assignment(2, 10)]
        elif name == BUNK_REQUESTS:
            col.get_full_list.return_value = []
        else:
            raise AssertionError(f"unexpected collection: {name}")
        return col

    pb = MagicMock()
    pb.collection.side_effect = make_collection

    session_satisfaction(session_cm_ids=[5], year=2026, scenario_id=None, pb_client=pb)

    # At least one persons filter must have been captured (chunked loop may produce multiple).
    assert captured_filters, "PERSONS collection was never queried"
    # All chunks must reference cm_ids 1 and 2 (they're in the same chunk of 100).
    persons_filter = captured_filters[0]
    assert "cm_id = 1" in persons_filter
    assert "cm_id = 2" in persons_filter
    # The filter must NOT be the old broad year-only filter.
    assert persons_filter != "year = 2026"


# ---------------------------------------------------------------------------
# Finding #1 — get_full_list must use the canonical `query_params={"filter": ...}`
# kwarg shape, not the wrong `filter=...` kwarg. The real pocketbase SDK
# (vaphes/pocketbase) exposes `def get_full_list(self, batch=100, query_params=None)`
# with no `filter` parameter — calling with `filter=...` raises TypeError in
# production. Test mocks accept any kwargs by default which masked this.
# ---------------------------------------------------------------------------


def test_get_full_list_called_with_query_params_not_filter_kwarg() -> None:
    """All collection.get_full_list calls must use query_params={'filter': ...}."""
    seen_calls: list[tuple[str, dict[str, Any]]] = []

    def make_collection(name: str) -> Any:
        col = MagicMock()

        def capture(*_args: Any, **kwargs: Any) -> list[Any]:
            seen_calls.append((name, dict(kwargs)))
            if name == BUNK_ASSIGNMENTS:
                return [_assignment(1, 10)]
            return []

        col.get_full_list.side_effect = capture
        return col

    pb = MagicMock()
    pb.collection.side_effect = make_collection

    session_satisfaction(session_cm_ids=[5], year=2026, scenario_id=None, pb_client=pb)

    assert seen_calls, "no get_full_list calls recorded"
    for collection_name, kwargs in seen_calls:
        assert "filter" not in kwargs, (
            f"{collection_name}.get_full_list called with bare filter= kwarg — "
            "real pocketbase SDK rejects this. Use query_params={'filter': ...}."
        )
        assert "query_params" in kwargs, f"{collection_name}.get_full_list missing query_params kwarg."
        assert "filter" in kwargs["query_params"], f"{collection_name}.get_full_list query_params missing 'filter' key."


# ---------------------------------------------------------------------------
# Finding #9 — session_satisfaction is public; direct callers bypass router
# scenario_id pattern validation. Defense in depth: validate inside the
# function too.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_scenario_id",
    [
        "'; DROP TABLE--",
        "abc",  # too short
        "abc!@#$%^&*()12",  # invalid chars
        "x" * 16,  # too long
        " " * 15,  # whitespace
    ],
)
def test_session_satisfaction_rejects_malformed_scenario_id(bad_scenario_id: str) -> None:
    pb = _build_pb_mock([], [], [])
    with pytest.raises(ValueError, match="scenario_id"):
        session_satisfaction(
            session_cm_ids=[999],
            year=2026,
            scenario_id=bad_scenario_id,
            pb_client=pb,
        )


def test_session_satisfaction_accepts_valid_scenario_id() -> None:
    pb = _build_pb_mock([], [], [])
    valid = "abc123def456ghi"  # exactly 15 alphanumerics
    # Must not raise on a structurally valid id
    session_satisfaction(
        session_cm_ids=[999],
        year=2026,
        scenario_id=valid,
        pb_client=pb,
    )


# ---------------------------------------------------------------------------
# #1171 — Real PocketBase Record shape regression
#
# bunk_assignments collection has `person` / `bunk` relation fields (returning
# PB record ids) and `cm_id` for the assignment itself — but NO `person_cm_id`
# / `bunk_cm_id` flat attributes. Reading those raises AttributeError on every
# real Record. The _assignment helper above already mirrors the real shape
# (relation strings + expand payload). These tests pin the contract.
# ---------------------------------------------------------------------------


def test_assignments_query_includes_expand_for_person_and_bunk() -> None:
    """The assignments fetch must request `expand="person,bunk"` so the SDK populates
    the relation payload. Without it, expand is empty and cm_ids cannot be resolved.
    """
    captured_kwargs: list[dict[str, Any]] = []

    def make_collection(name: str) -> Any:
        col = MagicMock()

        def capture(*_args: Any, **kwargs: Any) -> list[Any]:
            if name == BUNK_ASSIGNMENTS:
                captured_kwargs.append(dict(kwargs))
                return [_assignment(1, 100)]
            if name == PERSONS:
                return [_person(1, 10)]
            return []

        col.get_full_list.side_effect = capture
        return col

    pb = MagicMock()
    pb.collection.side_effect = make_collection

    session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=None, pb_client=pb)

    assert captured_kwargs, "BUNK_ASSIGNMENTS query was never issued"
    qp = captured_kwargs[0].get("query_params") or {}
    expand = qp.get("expand", "")
    assert "person" in expand, f"expand missing 'person': {expand!r}"
    assert "bunk" in expand, f"expand missing 'bunk': {expand!r}"


def test_assignment_with_unresolved_expand_is_skipped() -> None:
    """Defense: if the SDK returns an assignment without an expanded person/bunk
    (stale data, missing relation), skip it with a log warning rather than 500.
    """
    from types import SimpleNamespace

    persons = [_person(1, 10)]
    # Valid: person 1 in bunk 10
    good = _assignment(1, 10)
    # Pathological: relation strings present but expand payload missing
    bad = SimpleNamespace(id="abad", cm_id=42, person="p_orphan", bunk="b_orphan", session="s1", expand={})
    pb = _build_pb_mock(persons, [good, bad], [])
    resp = session_satisfaction([999], 2026, None, pb)

    # Bad assignment is skipped silently; good one survives.
    assert 1 in resp.campers


def test_assignment_with_non_numeric_cm_id_is_skipped() -> None:
    """CR1 — defense in depth: if the expanded person/bunk has a non-numeric cm_id
    (data hygiene gap, manual edit, future schema regression), int() raises and would
    abort the whole aggregation. Skip the row with a warning instead.
    """
    from types import SimpleNamespace

    persons = [_person(1, 10), _person(2, 10)]
    good = _assignment(1, 10)
    # Pathological: cm_id is a non-numeric string. Real PB schema types it as number,
    # but malformed data, partial-sync state, or schema migration gaps could surface
    # this. The aggregator must not 500 the whole /api/satisfaction call on one bad row.
    bad = SimpleNamespace(
        id="abad",
        cm_id=99,
        person="p_bad",
        bunk="b_bad",
        session="s1",
        expand={
            "person": SimpleNamespace(id="p_bad", cm_id="not-a-number"),
            "bunk": SimpleNamespace(id="b_bad", cm_id=20),
        },
    )
    pb = _build_pb_mock(persons, [good, bad], [])
    # Must not raise — bad row is skipped, good row is processed.
    resp = session_satisfaction([999], 2026, None, pb)
    assert 1 in resp.campers


def test_assignment_with_dict_style_expand_is_processed() -> None:
    """get_person_from_expand / get_bunk_from_expand are documented to handle BOTH
    object-style and dict-style expanded payloads. The aggregator must mirror that
    contract — using `getattr(person_data, "cm_id", None)` silently returns None
    for dict payloads, dropping valid assignments under the "missing cm_id" warning.
    """
    from types import SimpleNamespace

    persons = [_person(1, 10), _person(2, 10)]
    good = _assignment(1, 10)
    # Dict-style expand payload — both `expand` and inner relation values are dicts.
    dict_style = SimpleNamespace(
        id="adict",
        cm_id=2 * 1000 + 10,
        person="p_dict",
        bunk="b_dict",
        session="s1",
        expand={
            "person": {"id": "p_dict", "cm_id": 2},
            "bunk": {"id": "b_dict", "cm_id": 10},
        },
    )
    pb = _build_pb_mock(persons, [good, dict_style], [])
    resp = session_satisfaction([999], 2026, None, pb)
    # Both assignments must surface; dict-style must NOT be silently dropped.
    assert 1 in resp.campers
    assert 2 in resp.campers


def _unassigned_draft_row(person_cm_id: int) -> Any:
    """Scenario draft row where stranded_assignment_cleanup cleared the bunk rel.

    Mirrors the post-reconciliation state: person rel + expand intact,
    bunk rel is empty string, no bunk in expand payload. This is the
    canonical "camper sitting in the Unassigned pool" shape.
    """
    from types import SimpleNamespace

    return SimpleNamespace(
        id=f"a{person_cm_id:014d}",
        cm_id=person_cm_id * 1000,
        person=f"p{person_cm_id:014d}",
        bunk="",
        session=f"s{1:014d}",
        expand={"person": SimpleNamespace(id=f"p{person_cm_id:014d}", cm_id=person_cm_id)},
    )


def _dangling_bunk_assignment(person_cm_id: int, bunk_rel_id: str) -> Any:
    """Assignment row whose bunk rel points at a record that no longer exists.

    Mirrors a true data-corruption case: rel value is set but the expand
    payload omits bunk because the referenced record is gone.
    """
    from types import SimpleNamespace

    return SimpleNamespace(
        id=f"a{person_cm_id:014d}",
        cm_id=person_cm_id * 1000,
        person=f"p{person_cm_id:014d}",
        bunk=bunk_rel_id,
        session=f"s{1:014d}",
        expand={"person": SimpleNamespace(id=f"p{person_cm_id:014d}", cm_id=person_cm_id)},
    )


class TestUnresolvedExpandWarningClassification:
    """Distinguish intentional unassigned (silent) from dangling FK (WARN).

    stranded_assignment_cleanup clears `bunk` to '' on draft rows whose (session, bunk)
    pair drops out of bunk_plans — the camper falls back into the Unassigned
    pool by design. Warning about those is log noise. A non-empty bunk rel
    that fails to expand IS real corruption and must still surface.
    """

    def test_empty_bunk_rel_does_not_warn(self, caplog: pytest.LogCaptureFixture) -> None:
        persons = [_person(1)]
        assignments = [_unassigned_draft_row(person_cm_id=1)]
        pb = _build_pb_mock(persons, [], [], draft_assignments=assignments)

        valid_scenario = "scenarioabc1234"
        with caplog.at_level("WARNING", logger="bunking.satisfaction.aggregate"):
            session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=valid_scenario, pb_client=pb)

        unresolved = [r for r in caplog.records if "unresolved expand" in r.getMessage()]
        assert unresolved == [], f"unexpected warnings: {[r.getMessage() for r in unresolved]}"

    def test_dangling_bunk_rel_still_warns(self, caplog: pytest.LogCaptureFixture) -> None:
        persons = [_person(1)]
        assignments = [_dangling_bunk_assignment(person_cm_id=1, bunk_rel_id="b00000000000999")]
        pb = _build_pb_mock(persons, [], [], draft_assignments=assignments)

        valid_scenario = "scenarioabc1234"
        with caplog.at_level("WARNING", logger="bunking.satisfaction.aggregate"):
            session_satisfaction(session_cm_ids=[999], year=2026, scenario_id=valid_scenario, pb_client=pb)

        unresolved = [r for r in caplog.records if "unresolved expand" in r.getMessage()]
        assert len(unresolved) == 1, (
            f"expected exactly 1 unresolved-expand warning, got: {[r.getMessage() for r in unresolved]}"
        )
