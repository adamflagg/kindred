"""Season › History (D49, §7.6): aid_change_log grouped by operation. Fictional only."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

import api.constants.collections as collections
from api.services.financial_aid_season_history import (
    ENTITY_KINDS,
    NOT_IN_HISTORY,
    Figures,
    HistoryFilter,
    HistoryNotFoundError,
    Operation,
    SeasonHistoryService,
    Subject,
    entry_of,
    figures,
    for_reader,
    operation_out,
    operations,
    row_subject,
    subjects_from,
    summary_words,
    visible,
)

REG, FIN = "registrar@example.com", "finance@example.com"


def _rec(
    rid: str,
    entity: str,
    entity_id: str,
    op: str,
    *,
    actor: str = REG,
    action: str = "update",
    reason: str = "",
    at: str = "2027-03-09 17:00:00.000Z",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        entity=entity,
        entity_id=entity_id,
        action=action,
        actor=actor,
        reason=reason,
        operation_id=op,
        created=at,
    )


def _ops(*records: SimpleNamespace) -> list[Operation]:
    return operations(e for r in records if (e := entry_of(r)) is not None)


OP_A, OP_B, OP_R, OP_I, OP_S = ("a" * 15, "b" * 15, "r" * 15, "i" * 15, "s" * 15)


def test_one_line_per_operation_newest_first_with_its_counts() -> None:
    ops = _ops(
        _rec("l1", "aid_decisions", "reqemma00000001:1", OP_A, action="post", at="2027-03-09 17:00:00.000Z"),
        _rec(
            "l2",
            "aid_decisions",
            "reqliam00000001:1",
            OP_A,
            action="post",
            reason="March offers",
            at="2027-03-09 17:00:01.000Z",
        ),
        _rec("l3", "aid_hold_events", "reqemma00000001:h", OP_B, action="release", at="2027-03-10 17:00:00.000Z"),
    )
    assert [(o.operation_id, o.kind, len(o.entries)) for o in ops] == [(OP_B, "holds", 1), (OP_A, "offers", 2)]
    out = operation_out(ops[1])
    assert (out.rows, out.reason, out.actor) == (2, "March offers", REG)
    assert [(c.entity, c.action, c.rows) for c in out.counts] == [("aid_decisions", "post", 2)]
    assert out.at.isoformat() == "2027-03-09T17:00:01+00:00"


def test_a_rules_operation_names_its_versions_and_sections() -> None:
    (op,) = _ops(
        _rec("l1", "aid_rules", "2027:3:budget", OP_R, actor=FIN, action="approve"),
        _rec("l2", "aid_rules", "2027:3:award_tables", OP_R, actor=FIN, action="approve"),
    )
    out = operation_out(op)
    assert (out.kind, out.rules_versions, out.rules_sections) == ("rules", [3], ["award_tables", "budget"])


def test_intake_is_its_own_kind_and_scenario_rows_never_show() -> None:
    ops = _ops(
        _rec("l1", "aid_requests", "reqemma00000001", OP_I, actor="system:intake", action="create"),
        _rec("l2", "aid_scenario_trail", "t1", OP_S, actor=FIN, action="create"),
        _rec("l3", "aid_rules", "2027:4", OP_R, actor=FIN, action="save"),
        _rec("l4", "aid_scenario_options", "o1", OP_R, actor=FIN, action="update"),
    )
    assert [(o.operation_id, o.kind, len(o.entries)) for o in ops] == [(OP_R, "rules", 1), (OP_I, "intake", 1)]


def test_every_aid_collection_has_a_kind_or_is_left_out_on_purpose() -> None:
    """A new aid_* collection fails here until History classifies it (Decision 8)."""
    aid = {v for k, v in vars(collections).items() if k.startswith("AID_") and isinstance(v, str)} - {"aid_change_log"}
    assert aid, "no AID_* constants found"
    assert aid <= set(ENTITY_KINDS) | NOT_IN_HISTORY
    assert not set(ENTITY_KINDS) & NOT_IN_HISTORY


def test_rules_operations_are_left_out_without_rules() -> None:
    ops = _ops(
        _rec("l1", "aid_rules", "2027:3", OP_R, actor=FIN, action="save"),
        _rec("l2", "aid_session_capacity", "cap1", OP_B, actor=FIN, action="set_capacity"),
        _rec("l3", "aid_decisions", "reqemma00000001:1", OP_A, action="post"),
    )
    assert [o.operation_id for o in ops if visible(o, HistoryFilter())] == [OP_A]
    assert {o.operation_id for o in ops if visible(o, HistoryFilter(rules=True))} == {OP_R, OP_B, OP_A}


def test_the_filters_by_kind_person_day_and_text() -> None:
    ops = _ops(
        _rec(
            "l1",
            "aid_decisions",
            "reqemma00000001:1",
            OP_A,
            action="post",
            reason="March offers",
            at="2027-03-09 17:00:00.000Z",
        ),
        _rec(
            "l2",
            "aid_hold_events",
            "reqliam00000001:h",
            OP_B,
            actor=FIN,
            action="release",
            at="2027-03-12 07:30:00.000Z",
        ),
        _rec(
            "l3",
            "aid_requests",
            "reqolivia000001",
            OP_I,
            actor="system:intake",
            action="create",
            at="2027-03-08 17:00:00.000Z",
        ),
    )

    def shown(**kw: object) -> list[str]:
        return [o.operation_id for o in ops if visible(o, HistoryFilter(**kw))]  # type: ignore[arg-type]

    assert shown() == [OP_B, OP_A]  # intake hidden unless asked
    assert shown(include_intake=True) == [OP_B, OP_A, OP_I]
    assert shown(kinds=frozenset({"holds"})) == [OP_B]
    assert shown(actor=REG) == [OP_A]
    assert shown(text="march") == [OP_A]  # reason, case-insensitive
    assert shown(text="REQLIAM") == [OP_B]  # an entity id
    # 07:30 UTC on Mar 12 is still Mar 11 in camp time (Pacific).
    assert shown(since=date(2027, 3, 11), until=date(2027, 3, 11)) == [OP_B]
    assert shown(until=date(2027, 3, 10)) == [OP_A]


def test_a_row_with_no_created_time_has_no_place_in_the_order() -> None:
    assert entry_of(_rec("l1", "aid_decisions", "x", OP_A, at="")) is None


class _Reads:
    """Season › History's reads over in-memory log rows. `subjects` is the season's (requests, applications,
    corrections, grants, household links) light rows; `versions` the stored rules versions by (year, version). Each
    read that History must batch counts its calls, and each year-scoped read records the season it was asked for
    (`years`), so a test can pin "one read, never one per row" and "the right season"."""

    def __init__(
        self,
        *records: SimpleNamespace,
        subjects: tuple[Sequence[Any], Sequence[Any], Sequence[Any], Sequence[Any], Sequence[Any]] = (
            (),
            (),
            (),
            (),
            (),
        ),
        versions: Mapping[tuple[int, int], SimpleNamespace] | None = None,
    ) -> None:
        self.records = records
        self.subjects = subjects
        self.versions = dict(versions or {})
        self.name_calls: list[tuple[frozenset[int], frozenset[int]]] = []
        self.recorded_calls: list[tuple[list[str], list[str]]] = []
        self.version_calls: list[tuple[int, int]] = []
        self.years: set[int] = set()  # the seasons the year-scoped reads were asked for

    async def fetch_season_log(self, year: int) -> list[SimpleNamespace]:
        return [
            SimpleNamespace(**{k: v for k, v in vars(r).items() if k not in ("before", "after")}) for r in self.records
        ]

    async def fetch_operation(self, year: int, operation_id: str) -> list[SimpleNamespace]:
        return [r for r in self.records if r.operation_id == operation_id]

    async def fetch_subject_records(self, year: int) -> tuple[list[Any], list[Any], list[Any], list[Any], list[Any]]:
        self.years.add(year)
        requests, applications, corrections, grants, links = self.subjects
        return list(requests), list(applications), list(corrections), list(grants), list(links)

    async def fetch_recorded(
        self, year: int, operation_ids: Collection[str], entities: Collection[str]
    ) -> list[SimpleNamespace]:
        self.years.add(year)
        self.recorded_calls.append((sorted(operation_ids), sorted(entities)))
        return [r for r in self.records if r.operation_id in set(operation_ids) and r.entity in set(entities)]

    async def fetch_names(
        self, year: int, households: Collection[int], persons: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]:
        self.years.add(year)
        self.name_calls.append((frozenset(households), frozenset(persons)))
        return (
            {h: n for h, n in HOUSEHOLD_NAMES.items() if h in households},
            {p: n for p, n in PERSON_NAMES.items() if p in persons},
        )

    async def fetch_rules_version(self, year: int, version: int) -> SimpleNamespace | None:
        self.version_calls.append((year, version))
        return self.versions.get((year, version))


def _rules_save() -> SimpleNamespace:
    row = _rec("l9", "aid_rules", "2027:3", OP_R, actor=FIN, action="save")
    row.before = {"document": {"award_tables": {"camp": {"tiers": {"3": {"r1_pct": "74.5"}}}}}}
    row.after = '{"document": {"award_tables": {"camp": {"tiers": {"3": {"r1_pct": "72"}}}}}}'
    return row


def _post() -> SimpleNamespace:
    row = _rec("l1", "aid_decisions", "reqemma00000001:1", OP_A, action="post", at="2027-03-09 17:00:00.000Z")
    row.before, row.after = None, {"locked_amount": "1500"}
    return row


@pytest.mark.asyncio
async def test_a_page_counts_every_matching_operation_and_lists_the_people_the_reader_can_see() -> None:
    service = SeasonHistoryService(_Reads(_post(), _rules_save()))
    registrar = await service.page(2027, HistoryFilter(), page=1, per_page=1)
    assert (registrar.total, [o.operation_id for o in registrar.operations], registrar.actors) == (1, [OP_A], [REG])
    finance = await service.page(2027, HistoryFilter(rules=True), page=2, per_page=1)
    assert (finance.total, [o.operation_id for o in finance.operations]) == (2, [OP_A])  # page 2 of 2, newest first
    assert finance.actors == [FIN, REG]


@pytest.mark.asyncio
async def test_an_operation_expands_to_its_rows_and_their_field_diff() -> None:
    detail = await SeasonHistoryService(_Reads(_rules_save())).operation(2027, OP_R, rules=True)
    (row,) = detail.rows
    assert (detail.operation.kind, row.entity_id) == ("rules", "2027:3")
    (change,) = row.changes
    assert (change.path[-1], change.before, change.after) == ("r1_pct", "74.5", "72")


@pytest.mark.asyncio
async def test_a_registrar_cannot_open_a_rules_operation_and_an_unknown_one_is_not_found() -> None:
    service = SeasonHistoryService(_Reads(_rules_save(), _post()))
    with pytest.raises(HistoryNotFoundError):
        await service.operation(2027, OP_R, rules=False)
    with pytest.raises(HistoryNotFoundError):
        await service.operation(2027, "z" * 15, rules=True)
    assert (await service.operation(2027, OP_A, rules=False)).operation.kind == "offers"


def _tick_with_locks() -> list[SimpleNamespace]:
    """A round's first Posted tick: its decisions row and the rules sections it locks, in one operation."""
    return [
        _rec("l1", "aid_decisions", "reqemma00000001:1", OP_A, action="post", reason="March offers"),
        _rec("l2", "aid_rules", "2027:3:budget", OP_A, action="lock"),
        _rec("l3", "aid_rules", "2027:3:award_tables", OP_A, action="lock"),
    ]


def test_a_posted_tick_with_its_locks_is_offers_and_a_rules_only_operation_stays_rules() -> None:
    (mixed,) = _ops(*_tick_with_locks())
    assert mixed.kind == "offers"
    (rules_only,) = _ops(_rec("l1", "aid_rules", "2027:3", OP_R, actor=FIN, action="save"))
    assert rules_only.kind == "rules"


def test_a_reader_without_rules_sees_the_tick_minus_its_rules_rows() -> None:
    (mixed,) = _ops(*_tick_with_locks())
    seen = for_reader(mixed, rules=False)
    assert seen is not None
    assert [e.entity for e in seen.entries] == ["aid_decisions"]
    assert (seen.operation_id, seen.at, seen.actor, seen.kind, seen.reason) == (
        mixed.operation_id,
        mixed.at,
        mixed.actor,
        "offers",
        "March offers",
    )
    out = operation_out(seen)
    assert (out.rules_versions, out.rules_sections, out.rows) == ([], [], 1)
    assert [c.entity for c in out.counts] == ["aid_decisions"]


def test_for_reader_hides_a_rules_only_operation_and_leaves_a_rules_reader_whole() -> None:
    (rules_only,) = _ops(_rec("l1", "aid_rules", "2027:3", OP_R, actor=FIN, action="save"))
    assert for_reader(rules_only, rules=False) is None
    (mixed,) = _ops(*_tick_with_locks())
    assert for_reader(mixed, rules=True) is mixed


@pytest.mark.asyncio
async def test_the_page_and_detail_show_a_registrar_the_tick_without_the_locks() -> None:
    service = SeasonHistoryService(_Reads(*_tick_with_locks(), _rules_save()))
    page = await service.page(2027, HistoryFilter(), page=1, per_page=10)
    (op,) = page.operations
    assert (op.operation_id, op.kind, op.rows, op.rules_sections) == (OP_A, "offers", 1, [])
    detail = await service.operation(2027, OP_A, rules=False)
    assert [r.entity for r in detail.rows] == ["aid_decisions"]
    with pytest.raises(HistoryNotFoundError):
        await service.operation(2027, OP_R, rules=False)


@pytest.mark.asyncio
async def test_a_rules_reader_sees_the_tick_as_offers_with_every_row() -> None:
    service = SeasonHistoryService(_Reads(*_tick_with_locks()))
    (op,) = (await service.page(2027, HistoryFilter(rules=True), page=1, per_page=10)).operations
    assert (op.kind, op.rows, op.rules_sections) == ("offers", 3, ["award_tables", "budget"])
    detail = await service.operation(2027, OP_A, rules=True)
    assert sorted(r.entity for r in detail.rows) == ["aid_decisions", "aid_rules", "aid_rules"]


@pytest.mark.asyncio
async def test_a_search_for_a_stripped_rows_entity_id_finds_nothing_for_a_reader_without_rules() -> None:
    service = SeasonHistoryService(_Reads(*_tick_with_locks()))
    quiet = await service.page(2027, HistoryFilter(text="2027:3:budget"), page=1, per_page=10)
    assert quiet.total == 0
    loud = await service.page(2027, HistoryFilter(text="2027:3:budget", rules=True), page=1, per_page=10)
    assert loud.total == 1


# --- Back-end asks H1, H2, H4, H5 (fictional families only) -------------------------------------------------------

EMMA, SAMUEL, LIAM = "reqemma00000001", "reqsamuel000001", "reqliam00000001"
APP_JOHNSON, APP_GARCIA, COR_JOHNSON = "appjohnson00001", "appgarcia000001", "corjohnson00001"
JOHNSON, GARCIA = 1000001, 1000002
P_EMMA, P_SAMUEL, P_LIAM = 1000011, 1000012, 1000021
OP_T = "t" * 15
REQUEST_ROWS = (
    SimpleNamespace(id=EMMA, application=APP_JOHNSON, household_cm_id=JOHNSON, person_cm_id=P_EMMA),
    SimpleNamespace(id=SAMUEL, application=APP_JOHNSON, household_cm_id=JOHNSON, person_cm_id=P_SAMUEL),
    SimpleNamespace(id=LIAM, application=APP_GARCIA, household_cm_id=GARCIA, person_cm_id=P_LIAM),
)
APPLICATION_ROWS = (
    SimpleNamespace(id=APP_JOHNSON, household_cm_id=JOHNSON),
    SimpleNamespace(id=APP_GARCIA, household_cm_id=GARCIA),
)
CORRECTION_ROWS = (SimpleNamespace(id=COR_JOHNSON, application=APP_JOHNSON),)
GRANT_GARCIA, LINK_JOHNSON = "grantgarcia0001", "linkjohnson0001"
GRANT_ROWS = (SimpleNamespace(id=GRANT_GARCIA, household_cm_id=GARCIA),)
LINK_ROWS = (SimpleNamespace(id=LINK_JOHNSON, household_cm_id=JOHNSON),)
SEASON = (REQUEST_ROWS, APPLICATION_ROWS, CORRECTION_ROWS, GRANT_ROWS, LINK_ROWS)
HOUSEHOLD_NAMES = {JOHNSON: "The Johnson Family", GARCIA: "The Garcia Family"}
PERSON_NAMES = {P_EMMA: "Emma Johnson", P_SAMUEL: "Samuel Johnson", P_LIAM: "Liam Garcia"}
SUBJECTS = subjects_from(*SEASON)


def _row(
    rid: str,
    entity: str,
    entity_id: str,
    op: str,
    *,
    action: str = "update",
    actor: str = REG,
    reason: str = "",
    at: str = "2027-03-09 17:00:00.000Z",
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> SimpleNamespace:
    row = _rec(rid, entity, entity_id, op, actor=actor, action=action, reason=reason, at=at)
    row.before, row.after = before, after
    return row


def _tick() -> list[SimpleNamespace]:
    """The March Posted tick in small: three requests of two families, one of them a real $0 (D74)."""
    return [
        _row("t1", "aid_decisions", f"{EMMA}:1", OP_T, action="post", reason="March offers", after={"amount": "1420"}),
        _row("t2", "aid_decisions", f"{SAMUEL}:1", OP_T, action="post", after={"amount": "980.50"}),
        _row("t3", "aid_decisions", f"{LIAM}:1", OP_T, action="post", after={"amount": "0"}),
    ]


def test_a_row_is_about_the_request_or_application_its_id_names() -> None:
    about = SUBJECTS.of
    assert about("aid_decisions", f"{EMMA}:1") == Subject(JOHNSON, P_EMMA, EMMA)
    assert about("aid_hold_events", f"{LIAM}:placeholder_income") == Subject(GARCIA, P_LIAM, LIAM)
    assert about("aid_cancellations", SAMUEL) == Subject(JOHNSON, P_SAMUEL, SAMUEL)
    assert about("aid_requests", EMMA) == Subject(JOHNSON, P_EMMA, EMMA)
    # A payer share's id names the request and the PAYING household; the row is about the camper's family.
    assert about("aid_payer_shares", f"{LIAM}:{JOHNSON}") == Subject(GARCIA, P_LIAM, LIAM)
    assert about("aid_application_corrections", f"{EMMA}:income") == Subject(JOHNSON, P_EMMA, EMMA)  # an override
    assert about("aid_application_corrections", COR_JOHNSON) == Subject(JOHNSON, 0, "")  # casework's correction
    assert about("aid_applications", APP_GARCIA) == Subject(GARCIA, 0, "")
    # Grants and household links are keyed by their own id; a commitment's placement by its grant's.
    assert about("aid_grants", GRANT_GARCIA) == Subject(GARCIA, 0, "")
    assert about("aid_household_links", LINK_JOHNSON) == Subject(JOHNSON, 0, "")
    assert about("aid_grant_placements", f"commitment:{GRANT_GARCIA}") == Subject(GARCIA, 0, "")
    assert about("aid_grant_placements", "ledger:9001") is None  # a ledger line's household is only in its own JSON
    assert about("aid_decisions", "reqnobody000001:1") is None  # not a request of this season
    assert about("aid_grantors", "regional_fund") is None


def test_a_rules_row_is_about_no_one_even_with_a_request_shaped_id() -> None:
    """Review Focus 1: a rules-class row never names a family, so stripping it (for_reader) leaves no name behind."""
    for entity in ("aid_rules", "aid_session_capacity"):
        assert SUBJECTS.of(entity, EMMA) is None
        assert SUBJECTS.of(entity, f"{EMMA}:1") is None
    entry = entry_of(_row("x1", "aid_session_capacity", EMMA, OP_R, actor=FIN))
    assert entry is not None
    assert row_subject(entry, SUBJECTS, None, {"household_cm_id": JOHNSON}) is None


def test_a_row_naming_no_request_is_about_the_household_it_recorded() -> None:
    entry = entry_of(_row("g1", "aid_grant_placements", "ledger:9001", OP_A, action="place"))
    assert entry is not None
    recorded = {"household_cm_id": GARCIA, "grant": "ledger:9001"}
    assert row_subject(entry, SUBJECTS, None, recorded) == Subject(GARCIA, 0, "")
    assert row_subject(entry, SUBJECTS, recorded, None) == Subject(GARCIA, 0, "")  # a delete records only `before`
    assert row_subject(entry, SUBJECTS, None, {"household_cm_id": True}) is None  # never a bool
    assert row_subject(entry, SUBJECTS, None, None) is None


def test_a_posted_tick_reads_its_requests_families_and_the_total_it_locked() -> None:
    rows = _tick()
    (op,) = _ops(*rows)
    f = figures(op, SUBJECTS, {r.id: r.after for r in rows})
    assert f == Figures(requests=3, families=2, locked=Decimal("2400.50"), round3_entered=None, asked=None)
    assert summary_words(f) == "3 requests · 2 families · $2,400.50 locked"


def test_each_amount_keeps_its_own_basis_and_none_is_added_to_another() -> None:
    """⚠ Number meaning (Note 6: D49, D20/D74, D80/D130): a lock, a Round 3 amount and an ask are three figures,
    never one. An `award` row counts as entered for Round 3 only when it is a staff Round 3 amount."""
    rows = [
        _row("a1", "aid_decisions", f"{EMMA}:3", OP_A, action="award", after={"amount": "780", "round": 3}),
        _row("a2", "aid_decisions", f"{EMMA}:2", OP_A, action="ask", after={"amount": "1200"}),
        _row("a3", "aid_decisions", f"{SAMUEL}:1", OP_A, action="post", after={"amount": "1500"}),
        # An `award` that is not a staff Round 3 amount (round 1, a discretionary decision type) adds no money.
        _row(
            "a4",
            "aid_decisions",
            f"{LIAM}:1",
            OP_A,
            action="award",
            after={"amount": "50", "round": 1, "decision_type": "x"},
        ),
    ]
    (op,) = _ops(*rows)
    f = figures(op, SUBJECTS, {r.id: r.after for r in rows})
    assert (f.locked, f.round3_entered, f.asked) == (Decimal(1500), Decimal(780), Decimal(1200))
    assert summary_words(f) == ("3 requests · 2 families · $1,500 locked · $780 entered for Round 3 · $1,200 asked")


def test_a_zero_lock_is_a_real_zero_and_an_operation_without_money_says_none() -> None:
    zero = _row("z1", "aid_decisions", f"{LIAM}:1", OP_A, action="post", after={"amount": "0"})
    (op,) = _ops(zero)
    assert summary_words(figures(op, SUBJECTS, {"z1": zero.after})) == "1 request · 1 family · $0 locked"
    unpost = _row("u1", "aid_decisions", f"{LIAM}:1", OP_B, action="unpost", after={"note": "wrong family"})
    (op,) = _ops(unpost)
    f = figures(op, SUBJECTS, {"u1": unpost.after})
    assert (f.locked, summary_words(f)) == (None, "1 request · 1 family")
    (rules_op,) = _ops(_rec("r1", "aid_rules", "2027:3:budget", OP_R, actor=FIN, action="approve"))
    assert summary_words(figures(rules_op, SUBJECTS, {})) == ""


def test_a_recorded_amount_that_is_not_a_number_adds_no_money() -> None:
    rows = [
        _row("m1", "aid_decisions", f"{EMMA}:1", OP_A, action="post", after={"amount": "n/a"}),
        _row("m2", "aid_decisions", f"{SAMUEL}:1", OP_A, action="post", after={"amount": True}),
        _row("m3", "aid_decisions", f"{LIAM}:1", OP_A, action="post", after=None),
    ]
    (op,) = _ops(*rows)
    f = figures(op, SUBJECTS, {r.id: r.after for r in rows})
    assert (f.requests, f.families, f.locked) == (3, 2, None)


@pytest.mark.asyncio
async def test_the_list_and_the_opened_line_say_the_same_figures() -> None:
    reads = _Reads(*_tick(), _rules_save(), subjects=SEASON)
    page = await SeasonHistoryService(reads).page(2027, HistoryFilter(rules=True), page=1, per_page=50)
    line = next(o for o in page.operations if o.operation_id == OP_T)
    assert line.summary == "3 requests · 2 families · $2,400.50 locked"
    assert (line.figures.requests, line.figures.families, line.figures.locked) == (3, 2, 2400.5)
    assert next(o for o in page.operations if o.operation_id == OP_R).summary == ""
    # One recorded read for the whole page, and only for the lines that carry money rows.
    assert [ids for ids, _ in reads.recorded_calls] == [[OP_T]]
    detail = await SeasonHistoryService(reads).operation(2027, OP_T, rules=False)
    assert detail.operation.summary == line.summary
    assert detail.operation.figures == line.figures
    assert reads.years == {2027}  # every year-scoped read was for the season asked about


@pytest.mark.asyncio
async def test_a_registrar_reads_the_tick_with_its_locks_by_its_decisions_alone() -> None:
    """Regression guard: a rules row adds no family, request or money even unstripped, so what a registrar can't
    see never shows in the line's words or figures."""
    lock = _row("t4", "aid_rules", "2027:3:budget", OP_T, action="lock", after={"section_status": {}})
    service = SeasonHistoryService(_Reads(*_tick(), lock, subjects=SEASON))
    (registrar,) = (await service.page(2027, HistoryFilter(), page=1, per_page=50)).operations
    (finance,) = (await service.page(2027, HistoryFilter(rules=True), page=1, per_page=50)).operations
    assert registrar.summary == finance.summary == "3 requests · 2 families · $2,400.50 locked"
    assert (registrar.rows, finance.rows) == (3, 4)


@pytest.mark.asyncio
async def test_every_opened_row_names_its_family_and_camper_in_one_name_read() -> None:
    rows = [
        *_tick(),
        _row("t5", "aid_applications", APP_GARCIA, OP_T, after={"status": "complete"}),
        _row("t6", "aid_grant_placements", "ledger:9001", OP_T, action="place", after={"household_cm_id": GARCIA}),
        _row("t7", "aid_grantors", "regional_fund", OP_T, after={"note": "new address"}),
        _row("t8", "aid_grants", GRANT_GARCIA, OP_T, action="create", after={"household_cm_id": GARCIA}),
    ]
    reads = _Reads(*rows, subjects=SEASON)
    detail = await SeasonHistoryService(reads).operation(2027, OP_T, rules=False)
    named = {r.entity_id: (r.household_cm_id, r.household_name, r.camper_name) for r in detail.rows}
    assert named == {
        f"{EMMA}:1": (JOHNSON, "The Johnson Family", "Emma Johnson"),
        f"{SAMUEL}:1": (JOHNSON, "The Johnson Family", "Samuel Johnson"),
        f"{LIAM}:1": (GARCIA, "The Garcia Family", "Liam Garcia"),
        APP_GARCIA: (GARCIA, "The Garcia Family", None),
        "ledger:9001": (GARCIA, "The Garcia Family", None),  # from the row's own recorded household
        GRANT_GARCIA: (GARCIA, "The Garcia Family", None),  # from the grant's id
        "regional_fund": (None, None, None),
    }
    assert reads.name_calls == [(frozenset({JOHNSON, GARCIA}), frozenset({P_EMMA, P_SAMUEL, P_LIAM}))]
    assert reads.years == {2027}  # the name and subject reads were for the season asked about


@pytest.mark.asyncio
async def test_a_search_finds_a_family_or_a_camper_by_name() -> None:
    hold = _row("h1", "aid_hold_events", f"{LIAM}:income", OP_B, action="release", at="2027-03-10 17:00:00.000Z")
    reads = _Reads(*_tick(), hold, subjects=SEASON)
    service = SeasonHistoryService(reads)

    async def found(text: str) -> list[str]:
        page = await service.page(2027, HistoryFilter(text=text), page=1, per_page=50)
        return [o.operation_id for o in page.operations]

    # Each needle is in a name only, never in a reason, actor or entity id ("reqsamuel000001" holds no "johnson").
    assert await found("samuel johnson") == [OP_T]
    assert await found("GARCIA") == [OP_B, OP_T]  # Liam's hold, and his $0 lock in the tick
    assert await found("johnson family") == [OP_T]
    assert await found("olivia") == []
    assert len(reads.name_calls) == 4  # one batched read per search: never one per row or operation


@pytest.mark.asyncio
async def test_no_search_reads_no_names() -> None:
    reads = _Reads(*_tick(), subjects=SEASON)
    service = SeasonHistoryService(reads)
    await service.page(2027, HistoryFilter(), page=1, per_page=50)
    await service.page(2027, HistoryFilter(kinds=frozenset({"offers"})), page=1, per_page=50)
    assert reads.name_calls == []


@pytest.mark.asyncio
async def test_a_name_search_never_surfaces_an_operation_the_reader_cannot_see() -> None:
    """Review Focus 1: a hidden intake run and a rules-only operation stay hidden whatever the name."""
    intake = _row("i1", "aid_requests", EMMA, OP_I, actor="system:intake", action="create")
    capacity = _row("c1", "aid_session_capacity", EMMA, OP_R, actor=FIN, action="set_capacity")  # no reason
    service = SeasonHistoryService(_Reads(intake, capacity, subjects=SEASON))
    needle = "johnson family"  # in a name only: never in a reason, actor, entity id or collection
    assert (await service.page(2027, HistoryFilter(text=needle), page=1, per_page=50)).total == 0
    shown = await service.page(2027, HistoryFilter(text=needle, include_intake=True), page=1, per_page=50)
    assert [o.operation_id for o in shown.operations] == [OP_I]  # the name channel is live for a visible op
    finance = await service.page(2027, HistoryFilter(text=needle, rules=True, include_intake=True), page=1, per_page=50)
    assert [o.operation_id for o in finance.operations] == [OP_I]  # a capacity row names no one, even for finance
