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

import re
from types import SimpleNamespace
from unittest.mock import MagicMock

from bunking.graph.social_graph_builder import SocialGraphBuilder

CAMPER_ID = 1001
OTHER_CAMPER_ID = 2002
BUNK_CM_ID, SESSION_CM_ID, YEAR = 555, 999, 2026
LAST_YEAR = YEAR - 1


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


def _historical_row(
    session_type: str,
    session_name: str,
    bunk_name: str,
    record_id: str,
    person_cm_id: int = CAMPER_ID,
    year: int = LAST_YEAR,
) -> SimpleNamespace:
    """A bunk_assignments row as PocketBase actually returns it: ``expand`` is
    a dict keyed by relation name (matching real client behavior -- see
    ``expand.get("bunk")`` in the production code under test).

    ``person_cm_id``/``year`` carry the values the query's OTHER two predicates
    select on, so the mock below can honour them the way the database does.
    """
    return SimpleNamespace(
        id=record_id,
        person_cm_id=person_cm_id,
        year=year,
        expand={
            "session": SimpleNamespace(session_type=session_type, name=session_name),
            "bunk": SimpleNamespace(name=bunk_name),
        },
    )


def _pb_with_last_year_rows(rows: list[SimpleNamespace]) -> MagicMock:
    """Build a mock PB whose BUNK_ASSIGNMENTS historical lookup behaves like a
    real database for EVERY predicate the production query sends, not just the
    session-type clause.

    A mock that reads only one predicate silently blesses the other three: with
    an earlier version of this helper, dropping ``sort``, widening
    ``year = {last_year}`` to the current year, and deleting the
    ``person.cm_id`` scoping each left all three tests GREEN. So this one
    parses ``person.cm_id`` and ``year`` out of the filter and applies
    ``query_params["sort"]``, exactly as PocketBase would:

    * a predicate the filter OMITS stops narrowing anything, so a decoy row
      that only that predicate excludes will win the pick and fail the test;
    * with no ``sort``, ties resolve to the caller's row order -- standing in
      for whatever order SQLite returns from an unordered ``LIMIT 1``.
    """

    def _matches(row: SimpleNamespace, filt: str) -> bool:
        person = re.search(r"person\.cm_id = (\d+)", filt)
        if person and row.person_cm_id != int(person.group(1)):
            return False
        year = re.search(r"(?<!\.)\byear = (\d+)", filt)
        if year and row.year != int(year.group(1)):
            return False
        if "session.session_type" in filt:
            clause = f'session.session_type = "{row.expand["session"].session_type}"'
            if clause not in filt:
                return False
        return True

    def _collection_side_effect(name: str) -> MagicMock:
        col = MagicMock()
        if name == "bunk_assignments":
            col.get_full_list.side_effect = lambda *_a, **_kw: [_assignment(CAMPER_ID)]

            def _get_first(filt: str, query_params: dict[str, object] | None = None) -> SimpleNamespace:
                matched = [row for row in rows if _matches(row, filt)]
                sort = (query_params or {}).get("sort")
                if sort:
                    key = str(sort)
                    matched.sort(key=lambda r: r.id, reverse=key.startswith("-"))
                if not matched:
                    raise Exception("404 not found")
                return matched[0]

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


def _last_year_attrs(rows: list[SimpleNamespace]) -> tuple[str | None, str | None]:
    """Drive the production entry point and read the node attributes back."""
    graph = SocialGraphBuilder(pb=_pb_with_last_year_rows(rows)).build_bunk_graph(
        year=YEAR, bunk_cm_id=BUNK_CM_ID, session_cm_id=SESSION_CM_ID
    )
    node = graph.nodes[CAMPER_ID]
    return node["last_year_session"], node["last_year_bunk"]


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


def test_last_year_history_queries_the_prior_year_not_the_current_one() -> None:
    """The lookup must select ``year = year - 1``. A current-year row for the
    same person is a decoy: it exists (campers are assigned this year too) and
    is an eligible type, so only the year predicate keeps it out."""
    prior = _historical_row("main", "Session 1", "Cabin A-1", "aaa00000000001", year=LAST_YEAR)
    current = _historical_row("main", "Session 3", "Cabin C-3", "bbb00000000002", year=YEAR)

    assert _last_year_attrs([current, prior]) == ("Session 1", "Cabin A-1")


def test_last_year_history_is_scoped_to_the_person() -> None:
    """The lookup must select ``person.cm_id``. Another camper's prior-year row
    is a decoy: same year, same eligible type, so only the person predicate
    keeps it out -- without it every node would inherit one camper's history."""
    other = _historical_row("main", "Session 4", "Cabin D-4", "aaa00000000001", person_cm_id=OTHER_CAMPER_ID)
    mine = _historical_row("main", "Session 1", "Cabin A-1", "bbb00000000002")

    assert _last_year_attrs([other, mine]) == ("Session 1", "Cabin A-1")


def test_last_year_history_tie_break_is_deterministic_by_record_id() -> None:
    """Two ELIGIBLE rows for one person-year must resolve by ``sort: "id"``, so
    repeated builds agree. Rows are handed over in DESCENDING id order, which
    is what an unsorted ``LIMIT 1`` would return first -- only the sort makes
    the lowest id win."""
    high = _historical_row("main", "Session B", "Cabin B-2", "zzz00000000009")
    low = _historical_row("main", "Session A", "Cabin A-1", "aaa00000000001")

    assert _last_year_attrs([high, low]) == ("Session A", "Cabin A-1")
