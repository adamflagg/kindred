"""Staff exclusion from the per-bunk social graph (#1747).

Staff hold ``bunk_assignments`` rows (assigned to a cabin) but have no
``attendees`` row, so they are not enrolled campers. ``build_bunk_graph`` sourced
bunk membership straight from ``bunk_assignments`` with no attendee-status
filter, so staff rendered as grade-null, request-less isolated nodes. The pure
``filter_to_enrolled`` helper is the intersection point that drops them.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from bunking.graph.social_graph_builder import SocialGraphBuilder, filter_to_enrolled


def test_excludes_staff_not_in_enrolled_set() -> None:
    members = [100, 200, 300]  # 300 = staff: has an assignment, no attendee row
    enrolled = {100, 200}
    assert filter_to_enrolled(members, enrolled) == [100, 200]


def test_keeps_all_when_all_members_enrolled() -> None:
    assert filter_to_enrolled([1, 2], {1, 2, 3}) == [1, 2]


def test_empty_enrolled_set_excludes_everyone() -> None:
    assert filter_to_enrolled([1, 2], set()) == []


def test_preserves_order_and_duplicates() -> None:
    assert filter_to_enrolled([2, 1, 2], {1, 2}) == [2, 1, 2]


def _assignment(person_cm_id: int) -> SimpleNamespace:
    return SimpleNamespace(expand=SimpleNamespace(person=SimpleNamespace(cm_id=person_cm_id)))


def _person(cm_id: int, first_name: str) -> SimpleNamespace:
    return SimpleNamespace(
        cm_id=cm_id,
        first_name=first_name,
        last_name="Example",
        grade=7,
        gender="F",
        age=12,
        family_id=None,
    )


def test_build_bunk_graph_excludes_staff_member_end_to_end() -> None:
    """A person with a bunk assignment but no enrolled attendee row (staff) must
    not become a graph node, while a genuine enrolled camper does."""
    camper_id, staff_id = 1001, 9001
    bunk_cm_id, session_cm_id, year = 555, 999, 2026

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [_assignment(camper_id), _assignment(staff_id)]
        elif name == "attendees":
            # Only the camper is an enrolled attendee; staff has no attendee row.
            col.get_full_list.return_value = [SimpleNamespace(person_id=camper_id)]
        elif name == "bunk_requests":
            col.get_full_list.return_value = []
        elif name == "persons":

            def _get_first(flt: str, *_a: object, **_kw: object) -> SimpleNamespace:
                if str(camper_id) in flt:
                    return _person(camper_id, "Emma")
                if str(staff_id) in flt:
                    return _person(staff_id, "Staff")
                raise RuntimeError(f"no person for {flt!r}")

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_full_list.return_value = []
            col.get_first_list_item.side_effect = RuntimeError("no record")
        return col

    pb = MagicMock()
    pb.collection.side_effect = _collection_side_effect

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=year, bunk_cm_id=bunk_cm_id, session_cm_id=session_cm_id)

    assert camper_id in graph.nodes
    assert staff_id not in graph.nodes
    assert graph.number_of_nodes() == 1


def _pb_with_attendees(attendees: object) -> MagicMock:
    """Build a mock PB where the ATTENDEES lookup behaves per ``attendees``.

    ``attendees`` may be a list (returned from ``get_full_list``) or an
    Exception instance (raised from ``get_full_list``). Two members are always
    assigned to the bunk: camper 1001 and staff 9001, both resolvable as persons.
    """
    camper_id, staff_id = 1001, 9001

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [_assignment(camper_id), _assignment(staff_id)]
        elif name == "attendees":
            if isinstance(attendees, Exception):
                col.get_full_list.side_effect = attendees
            else:
                col.get_full_list.return_value = attendees
        elif name == "bunk_requests":
            col.get_full_list.return_value = []
        elif name == "persons":

            def _get_first(flt: str, *_a: object, **_kw: object) -> SimpleNamespace:
                if str(camper_id) in flt:
                    return _person(camper_id, "Emma")
                if str(staff_id) in flt:
                    return _person(staff_id, "Staff")
                raise RuntimeError(f"no person for {flt!r}")

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_full_list.return_value = []
            col.get_first_list_item.side_effect = RuntimeError("no record")
        return col

    pb = MagicMock()
    pb.collection.side_effect = _collection_side_effect
    return pb


def test_build_bunk_graph_fails_open_when_attendee_lookup_raises() -> None:
    """If the ATTENDEES query errors, filtering is skipped rather than blanking
    the graph — the fail-open path documented on ``_enrolled_member_cm_ids``.
    Both members (including the staff row) survive as nodes."""
    pb = _pb_with_attendees(RuntimeError("attendees collection unavailable"))

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=2026, bunk_cm_id=555, session_cm_id=999)

    assert 1001 in graph.nodes
    assert 9001 in graph.nodes  # staff not excluded: enrollment could not be resolved
    assert graph.number_of_nodes() == 2


def test_build_bunk_graph_excludes_staff_enrolled_only_in_non_bunking_session() -> None:
    """A real staff member (18+) can hold a bunk_assignment AND an enrolled
    Family Camp attendee row in the same year. The enrolled lookup must be scoped
    to bunking session types, so a family-camp enrollment does not rescue them
    from staff exclusion (#1791 F1)."""
    camper_id, staff_id = 1001, 9001

    # Each canned attendee row carries the session_type of the session it belongs
    # to. The camper is enrolled in a bunking session; the staff member only has a
    # Family Camp row.
    attendee_rows = [
        SimpleNamespace(person_id=camper_id, session_type="main"),
        SimpleNamespace(person_id=staff_id, session_type="family_camp"),
    ]

    def _attendees_get_full_list(*_a: object, **kwargs: object) -> list[SimpleNamespace]:
        # Simulate server-side session-type scoping: a row survives only if its
        # session_type passes the query filter (or the filter has no type scope,
        # i.e. the unscoped pre-fix behaviour that this test must fail against).
        query_params = kwargs.get("query_params", {})
        filt = query_params.get("filter", "") if isinstance(query_params, dict) else ""
        return [r for r in attendee_rows if "session_type" not in filt or f'session_type = "{r.session_type}"' in filt]

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.return_value = [_assignment(camper_id), _assignment(staff_id)]
        elif name == "attendees":
            col.get_full_list.side_effect = _attendees_get_full_list
        elif name == "bunk_requests":
            col.get_full_list.return_value = []
        elif name == "persons":

            def _get_first(flt: str, *_a: object, **_kw: object) -> SimpleNamespace:
                if str(camper_id) in flt:
                    return _person(camper_id, "Emma")
                if str(staff_id) in flt:
                    return _person(staff_id, "Staff")
                raise RuntimeError(f"no person for {flt!r}")

            col.get_first_list_item.side_effect = _get_first
        else:
            col.get_full_list.return_value = []
            col.get_first_list_item.side_effect = RuntimeError("no record")
        return col

    pb = MagicMock()
    pb.collection.side_effect = _collection_side_effect

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=2026, bunk_cm_id=555, session_cm_id=999)

    assert camper_id in graph.nodes
    assert staff_id not in graph.nodes  # family-camp enrollment must not rescue staff
    assert graph.number_of_nodes() == 1


def test_build_bunk_graph_fails_open_when_no_enrolled_attendee_resolves() -> None:
    """An empty ATTENDEES result (attendee data unavailable) resolves to ``None``,
    signalling the caller to skip filtering rather than drop every member."""
    pb = _pb_with_attendees([])  # zero enrolled attendees resolved

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=2026, bunk_cm_id=555, session_cm_id=999)

    assert 1001 in graph.nodes
    assert 9001 in graph.nodes
    assert graph.number_of_nodes() == 2
