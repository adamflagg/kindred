"""Development's dated columns and ZIP codes (Reports back end, Part C; clean spec §9.4; D67, D90), with real
pricing over the fictional season (decisions_fakes): Emma's Round 1 posted at 1,500 on March 9 2027; a regional
grant of 500 on her, posted February 10. The clock is April 1 2027. Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any

import pytest

from api.schemas.financial_aid_reports import DatedColumn
from api.services.financial_aid_development_repository import PersonRecord, StoredColumns
from api.services.financial_aid_development_service import FinancialAidDevelopmentService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.reports.zips import NO_ZIP, HouseholdAddress
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, FakeRules, approved, grant_row
from tests.unit.api.services.development_fakes import FakeDevelopmentStore, went
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore, report_season
from tests.unit.bunking.financial_aid.fixtures import with_lever

pytestmark = pytest.mark.asyncio

NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
EMMA, LIAM = 1000011, 1000021
DEVELOPMENT = "development@example.com"


def _development(**change: Any) -> FakeDevelopmentStore:
    store = FakeDevelopmentStore(
        registrations=[went(EMMA, 1000001, registered_on=date(2026, 11, 20)), went(LIAM, 1000002)],
        people=[PersonRecord(EMMA, 1000001, None, "Girl/woman", ""), PersonRecord(LIAM, 1000002, None, "", "")],
        homes={1000001: HouseholdAddress("94000", "US"), 1000002: HouseholdAddress("", "US")},
    )
    for key, value in change.items():
        setattr(store, key, value)
    return store


def _service(
    development: FakeDevelopmentStore, store: FakeDecisionsStore | None = None, rules: Any = None
) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return [grant_row("reqemma00000001", "500")] if year == YEAR else []

    return FinancialAidDevelopmentService(
        store or report_season(),
        FakeRules(approved(rules or intake_rules())),
        rows,
        development,
        FakeReportsStore(),
        clock=lambda: NOW,
    )


def _values(out: Any, key: str, group: str | None = "camp_pool") -> list[float | None]:
    return next(r.values for r in out.rows if r.key == key and r.group == group)


async def test_a_dated_column_reads_the_season_as_it_stood_that_day() -> None:
    """§9.4: "a query over dated records, never a frozen copy". On March 5 only the February grant was money."""
    development = _development(columns=StoredColumns("rdf000000000001", ((YEAR, date(2027, 3, 5)),)))
    out = await _service(development).development(YEAR)
    assert [(c.season, c.basis, c.as_of, c.label) for c in out.columns] == [
        (YEAR, "P", date(2027, 4, 1), "2027"),
        (YEAR, "P", date(2027, 3, 5), "2027 as of Mar 5"),
    ]
    assert _values(out, "total_awards") == [2000.0, 500.0]


async def test_a_dated_column_names_the_declined_line_it_cannot_rebuild_and_leaves_it_null() -> None:
    """Plan review Minor 5: a past read has no CampMinder cancellations, so "declined for insufficient aid" would
    read 0 on a dated column; it is null there and named, never a false zero."""
    development = _development(columns=StoredColumns("rdf000000000001", ((YEAR, date(2027, 3, 5)),)))
    out = await _service(development).development(YEAR)
    assert out.columns[0].not_rebuilt == []
    assert out.columns[1].not_rebuilt[0] == "declined_insufficient"
    assert _values(out, "declined_insufficient")[1] is None
    assert _values(out, "declined_insufficient")[0] is not None
    assert _values(out, "cancelled_schedule")[1] is None


async def test_a_dated_column_leaves_out_campers_registered_after_its_day() -> None:
    development = _development(
        columns=StoredColumns("rdf000000000001", ((YEAR, date(2027, 2, 1)),)),
        registrations=[went(EMMA, 1000001, registered_on=date(2027, 2, 15)), went(LIAM, 1000002)],
    )
    out = await _service(development).development(YEAR)
    assert _values(out, "total_requests") == [6000.0, 2000.0]  # Emma registered on Feb 15, after Feb 1


async def test_a_camper_cancelled_after_the_day_still_counts_on_it() -> None:
    development = _development(
        columns=StoredColumns("rdf000000000001", ((YEAR, date(2027, 3, 20)),)),
        registrations=[went(EMMA, 1000001, status=32, changed_on=date(2027, 3, 25)), went(LIAM, 1000002)],
    )
    out = await _service(development).development(YEAR)
    assert _values(out, "recipients")[1] == 1.0  # attended on March 20; cancelled on March 25
    assert _values(out, "recipients")[0] == 0.0  # not today


async def test_saving_columns_writes_once_and_a_repeat_writes_nothing() -> None:
    development = _development()
    service = _service(development)
    wanted = [DatedColumn(season=YEAR, as_of=date(2027, 3, 5)), DatedColumn(season=YEAR, as_of=date(2027, 2, 1))]
    out = await service.save_report_columns(wanted, actor=DEVELOPMENT)
    assert [c.as_of for c in out.columns] == [date(2027, 2, 1), date(2027, 3, 5)]
    assert len(development.operations) == 1
    assert development.log[-1]["entity_id"] == "development"
    await service.save_report_columns(list(reversed(wanted)), actor=DEVELOPMENT)
    assert len(development.operations) == 1


@pytest.mark.parametrize(
    ("column", "says"),
    [
        (DatedColumn(season=2026, as_of=date(2026, 4, 12)), "needs dated decisions"),
        (DatedColumn(season=YEAR, as_of=date(2027, 5, 1)), "not a past day"),
        (DatedColumn(season=YEAR, as_of=date(2027, 4, 1)), "not a past day"),  # today: not past yet, never shown
        (DatedColumn(season=YEAR, as_of=date(2025, 5, 1)), "not a past day"),
    ],
)
async def test_a_column_kindred_cannot_date_is_refused(column: DatedColumn, says: str) -> None:
    """D67: 2026 is reproduced with no decision dates, so it has no as-of views."""
    development = _development()
    with pytest.raises(ReportsRefusedError, match=says):
        await _service(development).save_report_columns([column], actor=DEVELOPMENT)
    assert development.operations == []


async def test_zip_tables_count_every_camper_and_put_all_their_money_on_their_households_zip() -> None:
    """D90: dollars and counts by ZIP; a ZIP with one family is a small group, never a family's row."""
    out = await _service(_development()).zip_codes(YEAR)
    assert (out.group, out.group_label) == ("camp_pool", "Camp")
    assert [(r.zip, r.campers, r.families) for r in out.every_camper.rows] == [("94000", 1, 1), (NO_ZIP, 1, 1)]
    assert out.with_aid is not None
    assert [(r.zip, r.campers, r.dollars) for r in out.with_aid.rows] == [("94000", 1, 2000.0)]
    assert out.not_built == []


async def test_a_season_without_decisions_has_no_aid_table_yet() -> None:
    """2026 until its decisions load (D67): every camper by ZIP works; the aid table waits, named."""
    store = FakeDecisionsStore()
    development = _development(registrations=[went(EMMA, 1000001, year=2026)])
    out = await _service(development, store).zip_codes(2026)
    assert out.with_aid is None
    assert [n.figure for n in out.not_built] == ["with_aid"]


async def test_a_grant_reversed_after_the_day_still_counts_on_it() -> None:
    """A dated column reads each line as it stood: posted by the day, and reversed (if ever) only after it."""
    reversed_later = replace(grant_row("reqemma00000001", "500"), is_reversed=True, reversal_date="2027-03-20")

    async def rows(year: int) -> Sequence[RegisterRow]:
        return [reversed_later] if year == YEAR else []

    development = _development(columns=StoredColumns("rdf000000000001", ((YEAR, date(2027, 3, 15)),)))
    service = FinancialAidDevelopmentService(
        report_season(), FakeRules(approved(intake_rules())), rows, development, FakeReportsStore(), clock=lambda: NOW
    )
    out = await service.development(YEAR)
    assert _values(out, "outside_awards") == [0.0, 500.0]  # reversed today; live on March 15


QUEST_CLAIMED = 1000103  # a session the (summer-group) Quest program claims by id


async def test_the_zip_tables_count_only_attendees_of_aid_eligible_sessions() -> None:
    """Owner rule (item 28): a camper whose only session no open-to-aid program claims is in neither table. Liam
    attends the session the Quest program claims, which stops being aid-eligible when that program closes to aid."""
    development = _development(registrations=[went(EMMA, 1000001), went(LIAM, 1000002, QUEST_CLAIMED)])
    narrowed = with_lever(intake_rules(), "programs.quest.open_to_aid", False)
    out = await _service(development, rules=narrowed).zip_codes(YEAR)
    assert [(r.zip, r.campers, r.families) for r in out.every_camper.rows] == [("94000", 1, 1)]
    assert out.every_camper.total.campers == 1
    assert out.with_aid is not None
    assert [(r.zip, r.campers) for r in out.with_aid.rows] == [("94000", 1)]


async def test_the_zip_tables_count_a_camper_of_an_open_session_who_got_no_aid_only_in_the_first() -> None:
    """The recipient table is the subset of the every-camper table that got money."""
    out = await _service(_development()).zip_codes(YEAR)
    assert out.every_camper.total.campers == 2
    assert out.with_aid is not None
    assert out.with_aid.total.campers == 1


async def test_the_zip_tables_do_not_count_a_camper_who_cancelled() -> None:
    development = _development(registrations=[went(EMMA, 1000001, status=32), went(LIAM, 1000002)])
    out = await _service(development).zip_codes(YEAR)
    assert out.every_camper.total.campers == 1
