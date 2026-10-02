"""Funding sources (Reports back end, Part C; clean spec §9.4; D88, D100): every outside source with its three facts
and its reporting group, which development and finance set. Fictional sources only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from api.constants.collections import AID_SOURCES
from api.schemas.financial_aid_reports import FundingSourceIn
from api.services.financial_aid_development_repository import GrantorRecord, SourceRecord
from api.services.financial_aid_development_service import (
    FinancialAidDevelopmentService,
    FunderNotFoundError,
    FundingSourceNotFoundError,
)
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


FUND = GrantorRecord("regional_fund", "Regional Camp Fund", retired=False)
OLD_FUND = GrantorRecord("old_fund", "Old Valley Fund", retired=True)
SPRING = SourceRecord(
    "src000000000006",
    "regional grant 2",
    "Regional Camp Fund (spring)",
    "outside",
    False,
    ("quest", "summer"),
    "regional_fund",
)
MYSTERY = SourceRecord("src000000000007", "mystery fund", "Mystery Fund", "unknown", False, ())


def _by_funder() -> FakeDevelopmentStore:
    return FakeDevelopmentStore(
        source_rows=[
            replace(REGIONAL, grantor_key="regional_fund"),
            SPRING,
            replace(SPLIT, grantor_key="old_fund"),
            YEARS_AT_CAMP,
            CAMP,
        ],
        grantor_rows=[FUND, OLD_FUND],
    )


async def test_rows_group_a_funders_descriptions_and_list_the_camps_own_read_only() -> None:
    """D159: one row per funder where the grantor directory groups descriptions (a retired grantor still names its
    row), else one per description; the camp's own sources last, read-only."""
    out = await _service(_by_funder()).funding_sources(YEAR)
    assert [(r.kind, r.name, r.retired, r.editable, len(r.descriptions)) for r in out.rows] == [
        ("funder", "Old Valley Fund", True, True, 1),
        ("funder", "Regional Camp Fund", False, True, 2),
        ("description", "Years-at-Camp Grant", False, True, 1),
        ("description", "Camp aid", False, False, 1),
    ]
    regional = out.rows[1]
    assert (regional.grantor_key, regional.group, regional.group_label, regional.incentive) == (
        "regional_fund",
        "camp_pool",
        "Camp",
        False,
    )
    assert out.rows[3].descriptions[0].funder_type == "camp"
    # the per-description edit list is unchanged: outside sources only
    assert [s.name for s in out.sources] == [
        "Regional Camp Fund",
        "Regional Camp Fund (spring)",
        "Two-Group Fund",
        "Years-at-Camp Grant",
    ]
    assert out.group_change_warning == "Changing this re-places household-level lines on tonight's sync."


async def test_an_unclassified_source_is_listed_read_only_under_its_own_section_not_hidden() -> None:
    """N3 (owner 2026-10-02): a funder type of unknown is shown to development so staff can fix the classification;
    it is neither editable here nor part of the per-description edit list."""
    store = _by_funder()
    store.source_rows.append(MYSTERY)
    out = await _service(store).funding_sources(YEAR)
    assert [(r.name, r.section, r.editable) for r in out.rows] == [
        ("Old Valley Fund", "outside", True),
        ("Regional Camp Fund", "outside", True),
        ("Years-at-Camp Grant", "outside", True),
        ("Mystery Fund", "unclassified", False),
        ("Camp aid", "camp", False),
    ]
    assert out.rows[3].descriptions[0].funder_type == "unknown"
    assert "Mystery Fund" not in [s.name for s in out.sources]


async def test_an_unclassified_source_cannot_be_saved_here_and_the_refusal_says_to_classify_it() -> None:
    """N3: the group and incentive save is for outside sources; the classification fix is the Sources route's."""
    with pytest.raises(ReportsRefusedError, match="classif"):
        await _service(FakeDevelopmentStore(source_rows=[MYSTERY])).save_funding_source(
            YEAR, MYSTERY.id, FundingSourceIn(group="camp_pool", incentive=False), actor=DEVELOPMENT
        )


async def test_a_group_change_says_it_re_places_on_tonights_sync_and_a_flag_change_does_not() -> None:
    """D43 / D159: the dialog warns before; the save says whether the families (Go's tie-break input) changed."""
    moved = await _service(_store()).save_funding_source(
        YEAR, YEARS_AT_CAMP.id, FundingSourceIn(group="camp_pool", incentive=True), actor=DEVELOPMENT
    )
    assert moved.families_changed is True
    flagged = await _service(_store()).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(group="camp_pool", incentive=True), actor=DEVELOPMENT
    )
    assert flagged.families_changed is False


async def test_a_funder_row_saves_its_descriptions_in_one_logged_operation() -> None:
    """Decision 48: one operation; each description writes only what changed (Decision 43)."""
    store = _by_funder()
    out = await _service(store).save_funder(
        YEAR,
        "regional_fund",
        FundingSourceIn(group="camp_pool", incentive=True, note="flagged by development"),
        actor=DEVELOPMENT,
    )
    [operation] = store.operations
    assert sorted(str(w.record_id) for w in operation) == [REGIONAL.id, SPRING.id]
    assert all(w.data == {"incentive": True} for w in operation)  # the group as shown: families kept
    assert (out.kind, out.incentive, out.families_changed) == ("funder", True, False)
    assert store.log[-1]["reason"] == "flagged by development"


async def test_a_several_groups_row_keeps_its_families_when_only_the_flag_changes() -> None:
    """A row shown as "several groups" saved with no group must not clear its descriptions' families."""
    store = FakeDevelopmentStore(
        source_rows=[replace(SPLIT, grantor_key="regional_fund"), replace(NARROW, grantor_key="regional_fund")],
        grantor_rows=[FUND],
    )
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn(group=None, incentive=True), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert all(w.data == {"incentive": True} for w in operation)


async def test_an_unknown_or_empty_funder_is_not_found() -> None:
    with pytest.raises(FunderNotFoundError, match="No funder"):
        await _service(_by_funder()).save_funder(
            YEAR, "nobody", FundingSourceIn(group="camp_pool", incentive=False), actor=DEVELOPMENT
        )


async def test_a_funder_whose_descriptions_are_unclassified_is_not_a_funder_to_save() -> None:
    """N3: unclassified sources are listed read-only; a funder save finds only outside descriptions, so it cannot
    touch them (the classification fix is the Sources route's)."""
    store = FakeDevelopmentStore(source_rows=[replace(MYSTERY, grantor_key="regional_fund")], grantor_rows=[FUND])
    with pytest.raises(FunderNotFoundError):
        await _service(store).save_funder(
            YEAR, "regional_fund", FundingSourceIn(group="camp_pool", incentive=True), actor=DEVELOPMENT
        )
    assert store.operations == []
