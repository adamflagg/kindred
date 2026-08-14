"""Last-year bunk history must be scoped to eligible session types in the
QUERY, not filtered after an arbitrary pick (see #2259, #2358).

``build_bunk_graph`` looks up each member's PRIOR-year ``bunk_assignments``
row to populate the ``last_year_session``/``last_year_bunk`` node attributes.
The lookup used to call ``get_first_list_item`` with no session-type filter --
an ARBITRARY row for ``(person, year)`` -- and only THEN check in Python
whether its session type was eligible ("main", "taste", "embedded", "ag"). A
person who held BOTH a family-camp row AND a main-session row for the prior
year could have the family row win the arbitrary pick, fail the type check,
and lose their real main-session history entirely -- silently, since "row
found but wrong type" and "no row at all" both leave the attributes ``None``.

#2350 widened ``bunk_assignments``' write key so a person can hold MORE rows
per year than before, raising the odds an arbitrary, unfiltered pick returns
the wrong one.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from bunking.graph.social_graph_builder import SocialGraphBuilder

CAMPER_ID = 1001
BUNK_CM_ID, SESSION_CM_ID, YEAR = 555, 999, 2026


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


def _historical_row(session_type: str, session_name: str, bunk_name: str, record_id: str) -> SimpleNamespace:
    """A bunk_assignments row as PocketBase actually returns it: ``expand`` is
    a dict keyed by relation name (matching real client behavior -- see
    ``expand.get("bunk")`` in the production code under test)."""
    return SimpleNamespace(
        id=record_id,
        expand={
            "session": SimpleNamespace(session_type=session_type, name=session_name),
            "bunk": SimpleNamespace(name=bunk_name),
        },
    )


def _pb_with_last_year_rows(rows: list[SimpleNamespace]) -> MagicMock:
    """Build a mock PB whose BUNK_ASSIGNMENTS historical lookup behaves like a
    real database: it returns the row whose session_type is named in the
    caller's filter string, when the filter names one. When the filter names
    none (the pre-fix, unfiltered query), it falls back to returning the
    first row in ``rows`` -- an arbitrary pick, standing in for whatever order
    SQLite happens to return without an explicit sort."""

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.side_effect = lambda *_a, **_kw: [_assignment(CAMPER_ID)]

            def _get_first(filt: str, **_kw: object) -> SimpleNamespace:
                if "session.session_type" in filt:
                    # Filtered (new) query: behave like a real DB -- return
                    # only a row whose type clause is actually in the filter,
                    # else nothing matched.
                    for row in rows:
                        clause = f'session.session_type = "{row.expand["session"].session_type}"'
                        if clause in filt:
                            return row
                    raise Exception("404 not found")
                # Unfiltered (old, pre-fix) query: arbitrary pick -- stands in
                # for whatever order SQLite returns without an explicit sort.
                if rows:
                    return rows[0]
                raise Exception("404 not found")

            col.get_first_list_item.side_effect = _get_first
        elif name == "attendees":
            col.get_full_list.return_value = [SimpleNamespace(person_id=CAMPER_ID)]
        elif name == "bunk_requests":
            col.get_full_list.return_value = []
        elif name == "persons":
            col.get_first_list_item.return_value = _person(CAMPER_ID, "Emma")
        else:
            col.get_full_list.return_value = []
            col.get_first_list_item.side_effect = RuntimeError("no record")
        return col

    pb = MagicMock()
    pb.collection.side_effect = _collection_side_effect
    return pb


def test_last_year_history_prefers_main_over_family_row() -> None:
    """A person with a family-camp row AND a main-session row for last year
    must yield the MAIN bunk/session -- not lose history to the family row
    just because it happened to be the arbitrary pick."""
    family_row = _historical_row("family", "Family Weekend", "Cabin F", "aaa00000000001")
    main_row = _historical_row("main", "Session 2", "Cabin B-3", "bbb00000000002")
    pb = _pb_with_last_year_rows([family_row, main_row])

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=YEAR, bunk_cm_id=BUNK_CM_ID, session_cm_id=SESSION_CM_ID)

    node = graph.nodes[CAMPER_ID]
    assert node["last_year_session"] == "Session 2"
    assert node["last_year_bunk"] == "Cabin B-3"


def test_last_year_history_still_works_with_a_single_eligible_row() -> None:
    """The overwhelming-majority case -- exactly one eligible row -- must be
    unaffected by pushing the type filter into the query."""
    main_row = _historical_row("main", "Session 1", "Cabin A-1", "ccc00000000003")
    pb = _pb_with_last_year_rows([main_row])

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=YEAR, bunk_cm_id=BUNK_CM_ID, session_cm_id=SESSION_CM_ID)

    node = graph.nodes[CAMPER_ID]
    assert node["last_year_session"] == "Session 1"
    assert node["last_year_bunk"] == "Cabin A-1"


def test_last_year_history_none_when_only_ineligible_rows_exist() -> None:
    """A person whose only prior-year row is a non-eligible type (e.g. family
    camp) must still get ``None`` attributes -- same end result as before,
    just reached via the query returning nothing rather than a post-hoc
    Python check."""
    family_row = _historical_row("family", "Family Weekend", "Cabin F", "ddd00000000004")
    pb = _pb_with_last_year_rows([family_row])

    graph = SocialGraphBuilder(pb=pb).build_bunk_graph(year=YEAR, bunk_cm_id=BUNK_CM_ID, session_cm_id=SESSION_CM_ID)

    node = graph.nodes[CAMPER_ID]
    assert node["last_year_session"] is None
    assert node["last_year_bunk"] is None
