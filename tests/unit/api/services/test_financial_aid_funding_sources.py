"""Funding sources (Reports back end, Part C; clean spec §9.4; D88, D100): every outside source with its three facts
and its reporting group, which development and finance set. Fictional sources only."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import pytest

from api.constants.collections import AID_SOURCES
from api.schemas.financial_aid_reports import FundingSourceIn
from api.services.financial_aid_development_repository import SourceRecord
from api.services.financial_aid_development_service import FinancialAidDevelopmentService, FundingSourceNotFoundError
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_service import ReportsRefusedError
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, FakeRules, approved
from tests.unit.api.services.development_fakes import FakeDevelopmentStore
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore

pytestmark = pytest.mark.asyncio

DEVELOPMENT = "development@example.com"
REGIONAL = SourceRecord(
    "src000000000001", "regional grant", "Regional Camp Fund", "outside", False, ("quest", "summer")
)
YEARS_AT_CAMP = SourceRecord("src000000000002", "years at camp", "Years-at-Camp Grant", "incentive", True, ())
CAMP = SourceRecord("src000000000003", "camp fa", "Camp aid", "camp", False, ())
SPLIT = SourceRecord("src000000000004", "two groups", "Two-Group Fund", "outside", False, ("family_camp", "summer"))
NARROW = SourceRecord("src000000000005", "summer only", "Summer-Only Fund", "outside", False, ("summer",))


def _service(development: FakeDevelopmentStore) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return []

    return FinancialAidDevelopmentService(
        FakeDecisionsStore(),
        FakeRules(approved(intake_rules())),
        rows,
        development,
        FakeReportsStore(),
        clock=lambda: datetime(2027, 4, 1, 17, 0, tzinfo=UTC),
    )


def _store() -> FakeDevelopmentStore:
    return FakeDevelopmentStore(source_rows=[REGIONAL, YEARS_AT_CAMP, CAMP, SPLIT])


async def test_the_list_holds_outside_sources_with_their_group_and_facts() -> None:
    """D100: one registry, two views; the camp's own aid is not a funding source."""
    out = await _service(_store()).funding_sources(YEAR)
    assert [(s.name, s.group, s.group_label, s.needs_group, s.incentive) for s in out.sources] == [
        ("Regional Camp Fund", "camp_pool", "Camp", False, False),
        ("Two-Group Fund", None, "several groups", False, False),
        ("Years-at-Camp Grant", None, "", True, True),
    ]
    assert [g.key for g in out.groups] == ["camp_pool", "weekend_pool", "bmitzvah_pool"]


async def test_setting_a_group_stores_the_program_families_that_pool_funds_with_one_logged_write() -> None:
    store = _store()
    out = await _service(store).save_funding_source(
        YEAR,
        YEARS_AT_CAMP.id,
        FundingSourceIn(group="camp_pool", incentive=True, note="set by development"),
        actor=DEVELOPMENT,
    )
    assert (out.group, out.needs_group, out.families) == ("camp_pool", False, ["quest", "summer"])
    [[write]] = store.operations
    assert (write.collection, write.action, write.log_action) == (AID_SOURCES, "update", "funding_source")
    assert write.data == {"implied_program_families": ["quest", "summer"]}
    assert store.log[-1]["reason"] == "set by development"


async def test_the_incentive_flag_is_d88s_and_never_the_funder_type() -> None:
    store = _store()
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(group="camp_pool", incentive=True), actor=DEVELOPMENT
    )
    assert (out.incentive, out.funder_type) == (True, "outside")
    [[write]] = store.operations
    assert write.data == {"incentive": True}


@pytest.mark.parametrize(
    ("source", "group"), [(NARROW, "camp_pool"), (SPLIT, None)], ids=["narrower-than-its-pool", "several-groups"]
)
async def test_an_incentive_only_change_never_rewrites_the_program_families(
    source: SourceRecord, group: str | None
) -> None:
    """Plan review I5: finance's narrower program setting (D100: "specific programs within them") and a source over
    several groups keep their families when only the flag changes; they drive Go's household-level tie-break."""
    store = FakeDevelopmentStore(source_rows=[source])
    out = await _service(store).save_funding_source(
        YEAR, source.id, FundingSourceIn(group=group, incentive=True), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert write.data == {"incentive": True}
    assert out.families == list(source.implied_program_families)


async def test_nothing_changed_writes_nothing() -> None:
    """A no-op never reaches 4a's change_row."""
    store = _store()
    await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(group="camp_pool", incentive=False), actor=DEVELOPMENT
    )
    assert store.operations == []


@pytest.mark.parametrize(
    ("source_id", "group", "error", "says"),
    [
        (CAMP.id, "camp_pool", ReportsRefusedError, "Only an outside source"),
        (REGIONAL.id, "nowhere", ReportsRefusedError, "budget pools"),
        ("src000000000099", "camp_pool", FundingSourceNotFoundError, "No aid source"),
    ],
)
async def test_refusals(source_id: str, group: str, error: type[Exception], says: str) -> None:
    store = _store()
    with pytest.raises(error, match=says):
        await _service(store).save_funding_source(
            YEAR, source_id, FundingSourceIn(group=group, incentive=False), actor=DEVELOPMENT
        )
    assert store.operations == []
