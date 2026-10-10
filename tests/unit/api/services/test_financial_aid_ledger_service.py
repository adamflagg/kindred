"""Campership ledger read service (sub-project 4). Fictional data only."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.financial_aid_ledger_service import (
    FinancialAidLedgerService,
    FinancialAidNotFoundError,
    as_of_cutoff,
    family_household_set,
    live_at,
    money,
    normalize_aid_label,
    program_bucket,
)

CAMP = "example camp financial assistance"
GRANT = "regional grant - north"
OUTSIDE = "outside program award (reclassified)"


def _posting(txn: int, household: int, amount: float, **kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "year": 2026,
        "transaction_cm_id": txn,
        "household_cm_id": household,
        "amount": amount,
        "source_key": CAMP,
        "effective_source_key": CAMP,
        "source_family": "camp_fa",
        "funder_type": "camp",
        "counts_toward_budget": True,
        "is_reversed": False,
        "reversal_date": "",
        "transaction_note": "",
        "attribution_level": "session",
        "attribution_method": "household_single_camper",
        "program_family": "summer",
        "person_cm_id": 0,
        "attributed_person_cm_id": 1001,
        "attributed_session_cm_id": 11,
        "candidate_program_families": [],
        "flags": [],
        "post_date": "2026-03-02 00:00:00.000Z",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _grant(txn: int, household: int, amount: float, **kw: Any) -> SimpleNamespace:
    kw = {
        "source_key": GRANT,
        "effective_source_key": GRANT,
        "source_family": "other_outside",
        "funder_type": "outside",
        "counts_toward_budget": False,
        **kw,
    }
    return _posting(txn, household, amount, **kw)


def _source(
    key: str, family: str, *, budget: bool, classified_by: str = "config_file", aid: bool = True, description: str = ""
) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"src-{family}",
        description_key=key,
        description=description or key.title(),
        source_name=family.replace("_", " "),
        source_family=family,
        funder_type="camp" if family == "camp_fa" else "outside",
        counts_as_aid=aid,
        counts_toward_budget=budget,
        grantor_key="",
        implied_program_families=[],
        classified_by=classified_by,
        note="",
    )


def _link(h: int, key: str, *, source: str = "auto", excluded: bool = False, id: str = "") -> SimpleNamespace:
    return SimpleNamespace(id=id or f"l{h}{key}", household_cm_id=h, family_key=key, source=source, excluded=excluded)


def _disposition(txn: int, flag: str, kind: str = "accepted_let_stand") -> SimpleNamespace:
    return SimpleNamespace(
        id=f"d{txn}{flag}",
        year=2026,
        transaction_cm_id=txn,
        flag=flag,
        disposition=kind,
        note="Finance let it stand",
        actor="finance@example.com",
        updated="2026-09-26 17:00:00.000Z",
    )


_DEFAULTS: dict[str, Any] = {"fetch_session_ids": set(), "fetch_session_seasons": {}}


def _repo(**values: Any) -> MagicMock:
    repo = MagicMock()
    for name in (
        "fetch_postings",
        "fetch_sources",
        "fetch_links",
        "fetch_overrides",
        "fetch_dispositions",
        "fetch_households",
        "fetch_persons",
        "fetch_household_persons",
        "fetch_enrollments",
        "fetch_fa_requests",
        "fetch_reversed_aid",
        "fetch_session_ids",
        "fetch_session_seasons",
        "fetch_off_season_session_rows",
        "fetch_aid_like_outside",
    ):
        setattr(repo, name, AsyncMock(return_value=values.get(name, _DEFAULTS.get(name, []))))
    return repo


# --- pure helpers ------------------------------------------------------------


def test_money_rounds_half_up_to_cents() -> None:
    assert money(Decimal("10.005")) == 10.01
    assert money(Decimal("-0.005")) == -0.01


@pytest.mark.parametrize(
    ("family", "level", "want"),
    [
        ("summer", "session", "summer"),
        ("", "ambiguous", "ambiguous"),
        ("", "person", "ambiguous"),
        ("", "none", "unattributed"),
        ("", "override", "ambiguous"),
    ],
)
def test_program_bucket(family: str, level: str, want: str) -> None:
    assert program_bucket(_posting(1, 100, -1, program_family=family, attribution_level=level)) == want


def test_family_household_set_matches_the_go_closure() -> None:
    links = [
        _link(100, "hh-100"),
        _link(200, "hh-100"),
        _link(200, "staff-merge", source="staff"),
        _link(700, "staff-merge", source="staff"),
        _link(400, "hh-100", source="staff", excluded=True),
    ]
    assert family_household_set(links, 100) == [100, 200, 700]
    assert family_household_set(links, 400) == [400]
    assert family_household_set(links, 900) == [900]


def test_family_household_set_returns_empty_for_a_non_positive_household() -> None:
    # Python twin of Go's aidFamilyIndex.HouseholdSet, which returns nothing for household <= 0.
    links = [_link(100, "hh-100"), _link(200, "hh-100")]
    assert family_household_set(links, 0) == []


@pytest.mark.parametrize(
    ("raw", "want"),
    [
        ("Regional Grant - North", "regional grant - north"),
        ("Regional Grant- North", "regional grant - north"),
        ("Regional Grant – North", "regional grant - north"),
        ("  REGIONAL   grant  -   north  ", "regional grant - north"),
        ("Session 3 (All-Gender Cabin)", "session 3 (all - gender cabin)"),
        ("   ", ""),
        ("Grant North", "grant north"),
        ("A\vB", "a b"),  # vertical tab -- the Go twin's RE2 \s alone omits it
        ("A B", "a b"),  # U+202F narrow no-break space -- outside RE2's \s
    ],
)
def test_normalize_aid_label_is_the_go_twin(raw: str, want: str) -> None:
    assert normalize_aid_label(raw) == want


def test_as_of_cutoff_is_the_end_of_the_day_in_camp_time() -> None:
    assert as_of_cutoff(date(2026, 3, 10)) == datetime(2026, 3, 11, 7, 0, tzinfo=UTC)  # PDT
    assert as_of_cutoff(date(2026, 1, 10)) == datetime(2026, 1, 11, 8, 0, tzinfo=UTC)  # PST


def test_live_at_counts_a_reversal_exactly_on_the_cutoff_instant() -> None:
    # Item 9 (final review, tests only): a posting reversed AT the as-of
    # cutoff instant has not yet been reversed as of that day's end, so it
    # still counts for that day.
    cutoff = as_of_cutoff(date(2026, 3, 10))  # 2026-03-11T07:00:00Z (PDT)
    posting = _posting(
        9001,
        100,
        -500.0,
        post_date="2026-03-02 17:00:00.000Z",
        is_reversed=True,
        reversal_date="2026-03-11 07:00:00.000Z",
    )
    assert live_at(posting, cutoff) is True


def test_live_at_does_not_count_a_reversal_at_23_59_59_camp_time_on_the_day() -> None:
    # 23:59:59 camp time on day D is one second before D's cutoff, so a
    # reversal there has already happened as of D's end and must not count.
    cutoff = as_of_cutoff(date(2026, 3, 10))  # 2026-03-11T07:00:00Z (PDT)
    posting = _posting(
        9002,
        200,
        -300.0,
        post_date="2026-03-02 17:00:00.000Z",
        is_reversed=True,
        reversal_date="2026-03-11 06:59:59.000Z",  # 23:59:59 PDT on Mar 10
    )
    assert live_at(posting, cutoff) is False


# --- household detail ---------------------------------------------------------


@pytest.mark.asyncio
async def test_household_detail_shows_the_familys_posting_history() -> None:
    session = SimpleNamespace(cm_id=11, name="Session 2", session_type="main")
    repo = _repo(
        fetch_links=[_link(100, "hh-100"), _link(200, "hh-100")],
        fetch_postings=[
            _posting(9002, 200, -900.0, post_date="2026-03-25 00:00:00.000Z"),
            _posting(
                9001,
                100,
                -500.0,
                is_reversed=True,
                reversal_date="2026-03-20 00:00:00.000Z",
                transaction_note="Reversed by a fictional staff user",
            ),
        ],
        fetch_household_persons=[
            SimpleNamespace(cm_id=1001, first_name="Emma", last_name="Johnson", preferred_name="")
        ],
        fetch_enrollments=[SimpleNamespace(person_id=1001, status="enrolled", expand={"session": session})],
        fetch_households=[SimpleNamespace(cm_id=100, mailing_title="", greeting="Test Family")],
        fetch_dispositions=[],
    )
    got = await FinancialAidLedgerService(repo).household(2026, 100)

    repo.fetch_postings.assert_awaited_once_with(2026, [100, 200], include_reversed=True)
    # Spec §10: the family's FA mirror rows only, never the whole season's.
    repo.fetch_fa_requests.assert_awaited_once_with(2026, [100, 200])
    assert got.family_households == [100, 200]
    assert got.display_name == "Test Family"
    assert [(p.transaction_cm_id, p.is_reversed) for p in got.postings] == [(9001, True), (9002, False)]
    assert got.postings[0].transaction_note == "Reversed by a fictional staff user"
    assert got.total_aid == 900.0
    assert [(e.person_cm_id, e.session_cm_id, e.status) for e in got.enrollments] == [(1001, 11, "enrolled")]


@pytest.mark.asyncio
async def test_household_detail_is_404_without_ledger_rows() -> None:
    with pytest.raises(FinancialAidNotFoundError):
        await FinancialAidLedgerService(_repo()).household(2026, 100)


# --- summary and as-of ---------------------------------------------------------


def _five_postings() -> list[SimpleNamespace]:
    return [
        _posting(9001, 100, -700.0),
        _posting(9002, 200, -300.0, attribution_level="ambiguous", program_family=""),
        _grant(9003, 300, -50.0, attribution_level="none", program_family=""),
        _posting(
            9004,
            300,
            -25.0,
            source_key="unknown grant",
            effective_source_key="unknown grant",
            source_family="unclassified",
            funder_type="unknown",
            counts_toward_budget=False,
            attribution_level="none",
            program_family="",
        ),
        _posting(
            9005,
            400,
            -600.0,
            effective_source_key=OUTSIDE,
            source_family="other_outside",
            funder_type="outside",
            counts_toward_budget=False,
        ),  # reclassified outside by an override
    ]


@pytest.mark.asyncio
async def test_summary_cells_levels_and_the_budget_honour_the_posting_classification() -> None:
    repo = _repo(fetch_postings=_five_postings())
    got = await FinancialAidLedgerService(repo).summary(2026)

    assert (got.total_aid, got.counts_toward_budget, got.as_of, got.basis) == (1675.0, 1000.0, None, "posted")
    assert got.by_level == {"session": 1300.0, "ambiguous": 300.0, "none": 75.0}
    assert [(c.program, c.source_family, c.amount, c.households) for c in got.cells] == [
        ("ambiguous", "camp_fa", 300.0, 1),
        ("summer", "camp_fa", 700.0, 1),
        ("summer", "other_outside", 600.0, 1),
        ("unattributed", "other_outside", 50.0, 1),
        ("unattributed", "unclassified", 25.0, 1),
    ]


@pytest.mark.asyncio
async def test_summary_splits_each_program_by_who_paid() -> None:
    """F10 as money-v2 draws it (owner 10-08, R3-2): per program, camp aid (funder type camp, after any
    reclassification), outside grants (outside and incentive) and anything unclassified; the footer's three
    season figures add up to total_aid."""
    incentive = _grant(9006, 500, -10.0, funder_type="incentive")  # an incentive is an outside grant (D55)
    got = await FinancialAidLedgerService(_repo(fetch_postings=[*_five_postings(), incentive])).summary(2026)
    assert [
        (r.program, r.camp_aid, r.outside_grants, r.unclassified, r.total, r.postings, r.households)
        for r in got.by_program
    ] == [
        ("ambiguous", 300.0, 0.0, 0.0, 300.0, 1, 1),
        ("summer", 700.0, 610.0, 0.0, 1310.0, 3, 3),  # 9005 was reclassified outside: it is outside here
        ("unattributed", 0.0, 50.0, 25.0, 75.0, 2, 1),
    ]
    assert (got.camp_aid, got.outside_grants, got.unclassified) == (1000.0, 660.0, 25.0)
    assert got.camp_aid + got.outside_grants + got.unclassified == got.total_aid == 1685.0


@pytest.mark.asyncio
async def test_summary_names_each_program_with_the_rules_label_not_its_key() -> None:
    """The screens show `program_label`; the key (a program family) is for filtering. The words come from the season's
    rules programs. A bucket the rules don't name (ambiguous, unattributed) carries ''."""
    asked: list[int] = []

    async def labels(year: int) -> dict[str, str]:
        asked.append(year)
        return {"summer": "Fictional Summer Program", "quest": "Fictional Quest"}

    got = await FinancialAidLedgerService(_repo(fetch_postings=_five_postings()), program_labels=labels).summary(2026)
    assert asked == [2026]
    assert [(r.program, r.program_label) for r in got.by_program] == [
        ("ambiguous", ""),
        ("summer", "Fictional Summer Program"),
        ("unattributed", ""),
    ]
    assert {(c.program, c.program_label) for c in got.cells} == {
        ("ambiguous", ""),
        ("summer", "Fictional Summer Program"),
        ("unattributed", ""),
    }


@pytest.mark.asyncio
async def test_summary_labels_default_to_empty_without_a_label_source() -> None:
    got = await FinancialAidLedgerService(_repo(fetch_postings=_five_postings())).summary(2026)
    assert {r.program_label for r in got.by_program} == {""}


@pytest.mark.asyncio
async def test_summary_camp_aid_levels_are_shares_of_camp_aid_only() -> None:
    """The mock's line: placed / at household level / not placed, each a share of camp aid. The outside grant at
    level none (9003) is not in "not placed"."""
    got = await FinancialAidLedgerService(_repo(fetch_postings=_five_postings())).summary(2026)
    assert [(lvl.group, lvl.amount, lvl.share) for lvl in got.camp_aid_levels] == [
        ("placed", 700.0, 0.7),
        ("household", 300.0, 0.3),
        ("not_placed", 0.0, 0.0),
    ]


@pytest.mark.asyncio
async def test_program_family_money_is_placed_and_only_the_household_level_row_is_at_household_level() -> None:
    """Owner ruling (final audit): money attributed to a program (a Family Camp household request) is placed on a
    request; "at household level" is only the ambiguous bucket, the program table's "Household level" row."""
    postings = [
        _posting(9001, 100, -400.0, attribution_level="program_family"),
        _posting(9002, 200, -100.0, attribution_level="ambiguous", program_family=""),
    ]
    got = await FinancialAidLedgerService(_repo(fetch_postings=postings)).summary(2026)
    assert [(lvl.group, lvl.amount, lvl.share) for lvl in got.camp_aid_levels] == [
        ("placed", 400.0, 0.8),
        ("household", 100.0, 0.2),
        ("not_placed", 0.0, 0.0),
    ]


@pytest.mark.asyncio
async def test_a_season_with_no_camp_aid_has_zero_shares() -> None:
    got = await FinancialAidLedgerService(_repo(fetch_postings=[_grant(9003, 300, -50.0)])).summary(2026)
    assert [(lvl.group, lvl.share) for lvl in got.camp_aid_levels] == [
        ("placed", 0.0),
        ("household", 0.0),
        ("not_placed", 0.0),
    ]


# Review Focus 6.
@pytest.mark.asyncio
async def test_summary_as_of_counts_what_was_live_on_that_date() -> None:
    postings = [
        _posting(9001, 100, -500.0, post_date="2026-03-02 17:00:00.000Z"),
        _posting(
            9002,
            200,
            -300.0,
            post_date="2026-03-02 17:00:00.000Z",
            is_reversed=True,
            reversal_date="2026-03-20 17:00:00.000Z",
        ),
        _posting(9003, 300, -200.0, post_date="2026-04-10 17:00:00.000Z"),
        _posting(9004, 400, -40.0, post_date="2026-03-11 06:59:00.000Z"),  # 23:59 on Mar 10, camp time
        _posting(9005, 500, -60.0, post_date="2026-03-11 07:00:00.000Z"),  # 00:00 on Mar 11, camp time
        _posting(9006, 600, -10.0, post_date=""),
    ]
    repo = _repo(fetch_postings=postings)
    service = FinancialAidLedgerService(repo)

    on_mar_10 = await service.summary(2026, as_of=date(2026, 3, 10))
    repo.fetch_postings.assert_awaited_with(2026, include_reversed=True)
    assert (on_mar_10.total_aid, on_mar_10.as_of, on_mar_10.undated_postings) == (840.0, "2026-03-10", 1)
    assert (await service.summary(2026, as_of=date(2026, 3, 25))).total_aid == 600.0
    assert (await service.summary(2026)).total_aid == 810.0  # live now: 9001, 9003, 9004, 9005, 9006


# --- net totals (the sub-project 11 seam) --------------------------------------


# Review Focus 8.
@pytest.mark.asyncio
async def test_net_totals_do_not_depend_on_the_posting_habit() -> None:
    postings = [
        _posting(9001, 100, -900.0, attributed_person_cm_id=1001),  # posted once
        _posting(
            9002, 200, -600.0, attributed_person_cm_id=1002, is_reversed=True, reversal_date="2026-03-20 00:00:00.000Z"
        ),  # reversed ...
        _posting(9003, 200, -900.0, attributed_person_cm_id=1002, post_date="2026-03-20 00:00:00.000Z"),  # ... reposted
        _posting(9004, 300, -600.0, attributed_person_cm_id=1003),  # first line ...
        _posting(
            9005, 300, -300.0, attributed_person_cm_id=1003, post_date="2026-03-20 00:00:00.000Z"
        ),  # ... added line
    ]
    got = await FinancialAidLedgerService(_repo(fetch_postings=postings)).net_totals(2026)
    assert {(r.posting_household_cm_id, r.attributed_person_cm_id): r.amount for r in got.rows} == {
        (100, 1001): 900.0,
        (200, 1002): 900.0,
        (300, 1003): 900.0,
    }
    assert got.total_aid == 2700.0
    assert got.basis == "posted"


@pytest.mark.asyncio
async def test_net_totals_keep_each_posting_household_and_name_the_family() -> None:
    # Separated parents (fictional): each household posts its share for one child.
    postings = [
        _posting(9001, 300, -400.0, attributed_person_cm_id=1005),
        _posting(9002, 400, -600.0, attributed_person_cm_id=1005),
        _grant(9003, 400, -100.0, attributed_person_cm_id=1005),
    ]
    links = [_link(300, "hh-300"), _link(400, "hh-300")]
    got = await FinancialAidLedgerService(_repo(fetch_postings=postings, fetch_links=links)).net_totals(2026)
    assert [
        (r.posting_household_cm_id, r.family_id, r.family_households, r.source_family, r.amount) for r in got.rows
    ] == [
        (300, 300, [300, 400], "camp_fa", 400.0),
        (400, 300, [300, 400], "camp_fa", 600.0),
        (400, 300, [300, 400], "other_outside", 100.0),
    ]


# --- data quality -------------------------------------------------------------


@pytest.mark.asyncio
async def test_data_quality_lists_unclassified_orphans_and_open_versus_accepted_flags() -> None:
    unclassified = _source("mystery grant", "unclassified", budget=False, classified_by="unclassified")
    repo = _repo(
        fetch_postings=[
            _posting(
                9001,
                100,
                -100.0,
                source_key="mystery grant",
                effective_source_key="mystery grant",
                source_family="unclassified",
                flags=["unclassified_source"],
            ),
            _posting(
                9002,
                100,
                -200.0,
                attribution_level="none",
                program_family="",
                flags=["live_aid_on_cancelled_enrollment"],
            ),
            _posting(9003, 200, -900.0, flags=["implied_program_mismatch"]),
            _posting(9004, 200, -50.0, is_reversed=True, reversal_date="2026-03-20 00:00:00.000Z"),
        ],
        fetch_sources=[unclassified, _source(CAMP, "camp_fa", budget=True)],
        fetch_dispositions=[_disposition(9003, "implied_program_mismatch", "accepted_late_grant")],
        fetch_reversed_aid=[
            SimpleNamespace(cm_id=9100, household_cm_id=100, amount=-300.0),
            SimpleNamespace(cm_id=9100, household_cm_id=100, amount=300.0),  # a complete pair
            SimpleNamespace(cm_id=9101, household_cm_id=200, amount=450.0),  # an orphan leg
        ],
    )
    got = await FinancialAidLedgerService(repo).data_quality(2026)

    assert [(u.source_key, u.postings, u.amount) for u in got.unclassified_sources] == [("mystery grant", 1, 100.0)]
    assert [(o.transaction_cm_id, o.net_posted) for o in got.orphan_reversal_legs] == [(9101, 450.0)]
    assert got.flag_counts == {"unclassified_source": 1, "live_aid_on_cancelled_enrollment": 1}
    assert got.accepted_flag_counts == {"implied_program_mismatch": 1}
    assert [p.transaction_cm_id for p in got.flagged_postings] == [9001, 9002]
    assert got.no_enrollment_postings == 1


@pytest.mark.asyncio
async def test_unclassified_sources_are_data_qualitys_list_from_two_reads() -> None:
    """Slice 1's Today reads the same list as Data quality, without Data quality's other reads."""
    unclassified = _source("mystery grant", "unclassified", budget=False, classified_by="unclassified")
    repo = _repo(
        fetch_postings=[
            _posting(9001, 100, -100.0, source_key="mystery grant", effective_source_key="mystery grant"),
            _posting(9002, 100, -50.0, source_key="unknown line", effective_source_key="unknown line"),
            _posting(9003, 200, -900.0),
        ],
        fetch_sources=[unclassified, _source(CAMP, "camp_fa", budget=True)],
    )
    got = await FinancialAidLedgerService(repo).unclassified_sources(2026)
    assert [(u.source_key, u.postings, u.amount) for u in got] == [
        ("mystery grant", 1, 100.0),
        ("unknown line", 1, 50.0),
    ]
    assert got == (await FinancialAidLedgerService(repo).data_quality(2026)).unclassified_sources
    repo.fetch_postings.assert_any_await(2026)


@pytest.mark.asyncio
async def test_unclassified_list_reads_the_description_that_classifies_a_line_now() -> None:
    """A line whose own description is unknown but which an override moved onto a classified source is resolved,
    not listed; a plain unknown line is still listed under its own description (§5.5)."""
    repo = _repo(
        fetch_postings=[
            _posting(9001, 100, -100.0, source_key="mystery fund", effective_source_key=CAMP),
            _posting(9002, 100, -50.0, source_key="unknown line", effective_source_key="unknown line"),
            _posting(9003, 200, -25.0, source_key="blank effective", effective_source_key=""),
        ],
        fetch_sources=[_source(CAMP, "camp_fa", budget=True)],
    )
    got = await FinancialAidLedgerService(repo).unclassified_sources(2026)
    assert [(u.source_key, u.postings, u.amount) for u in got] == [
        ("blank effective", 1, 25.0),
        ("unknown line", 1, 50.0),
    ]


# Review Focus 5.
@pytest.mark.asyncio
async def test_data_quality_surfaces_dangling_overrides_dispositions_and_stale_staff_links() -> None:
    repo = _repo(
        fetch_postings=[
            _posting(9001, 100, -100.0),
            _posting(9002, 100, -80.0, is_reversed=True, reversal_date="2026-03-20 00:00:00.000Z"),
        ],
        fetch_sources=[_source(CAMP, "camp_fa", budget=True)],
        fetch_overrides=[
            SimpleNamespace(transaction_cm_id=9001),
            SimpleNamespace(transaction_cm_id=9002),
            SimpleNamespace(transaction_cm_id=9055),
        ],
        fetch_dispositions=[_disposition(9002, "unclassified_source"), _disposition(9066, "implied_program_mismatch")],
        fetch_links=[
            _link(100, "hh-100"),
            _link(200, "hh-100"),
            _link(600, "hh-100", source="staff", id="keep"),  # joins a live family
            _link(700, "hh-999", source="staff", id="stale"),  # its key no longer exists
            _link(800, "hh-100", source="staff", excluded=True, id="excl"),
            # Item 7 (final review, ruling): an excluded staff row whose family_key
            # no longer exists among the AUTO links -- a re-keyed family made the
            # exclusion stop applying, and that must be surfaced too.
            _link(900, "hh-404", source="staff", excluded=True, id="excl-rekeyed"),
        ],
    )
    got = await FinancialAidLedgerService(repo).data_quality(2026)

    assert got.dangling_overrides == [9055]  # 9002 was reversed, but its history row still exists
    assert [(d.transaction_cm_id, d.flag) for d in got.dangling_dispositions] == [(9066, "implied_program_mismatch")]
    assert [(s.id, s.household_cm_id, s.family_key) for s in got.stale_staff_links] == [
        ("stale", 700, "hh-999"),
        ("excl-rekeyed", 900, "hh-404"),
    ]


@pytest.mark.asyncio
async def test_data_quality_lists_off_season_sessions_and_aid_like_rows_outside_the_categories() -> None:
    repo = _repo(
        fetch_postings=[_posting(9001, 100, -100.0)],
        fetch_sources=[
            _source(CAMP, "camp_fa", budget=True, description="Example Camp Financial Assistance"),
            _source("staff discount grant", "placeholder", budget=False, classified_by="staff", aid=False),
        ],
        fetch_session_ids={11, 12},
        fetch_off_season_session_rows=[
            SimpleNamespace(cm_id=9201, session_cm_id=31, amount=1200.0),
            SimpleNamespace(cm_id=9202, session_cm_id=31, amount=300.0),
            SimpleNamespace(cm_id=9203, session_cm_id=99, amount=50.0),
        ],
        fetch_session_seasons={31: {2025}},
        fetch_aid_like_outside=[
            SimpleNamespace(cm_id=9301, financial_category_cm_id=5000, description="Summer Grant", amount=-250.0),
            SimpleNamespace(
                cm_id=9302, financial_category_cm_id=3839, description="Staff Discount Grant", amount=-80.0
            ),
            SimpleNamespace(cm_id=9303, financial_category_cm_id=5000, description="Summer Grant", amount=-50.0),
        ],
    )
    got = await FinancialAidLedgerService(repo).data_quality(2026)

    repo.fetch_off_season_session_rows.assert_awaited_once_with(2026, {11, 12})
    repo.fetch_aid_like_outside.assert_awaited_once_with(2026, ["Example Camp Financial Assistance"])
    assert [(s.session_cm_id, s.transactions, s.net_posted, s.other_seasons) for s in got.cross_season_sessions] == [
        (31, 2, 1500.0, [2025])
    ]
    assert [(s.session_cm_id, s.transactions) for s in got.unknown_sessions] == [(99, 1)]
    # The staff-classified "not aid" description is a decision already made, so it is not re-raised.
    assert [
        (a.category_cm_id, a.description, a.transactions, a.net_posted) for a in got.aid_like_outside_categories
    ] == [(5000, "Summer Grant", 2, -300.0)]


def test_program_labels_come_from_the_rules_programs_and_only_the_fixed_words_without_rules() -> None:
    from api.services.financial_aid_program_labels import program_labels
    from tests.unit.bunking.financial_aid.fixtures import fictional_rules

    labels = program_labels(fictional_rules())
    assert labels["summer"] == "Summer"
    assert labels["family_camp"] == "Family camp"
    assert program_labels(None) == {"quest": "Quest", "teen": "Teen Leadership", "bmitzvah": "B*Mitzvah"}
