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
