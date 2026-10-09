"""Funding sources (Reports back end, Part C; clean spec §9.4; D88, D100): every outside source with its three facts
and its reporting group, which development and finance set. Fictional sources only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from api.constants.collections import AID_SOURCES
from api.schemas.financial_aid import SourceChangeOut
from api.schemas.financial_aid_reports import FundingSourceIn
from api.services.financial_aid_development_repository import DevelopmentRepository, GrantorRecord, SourceRecord
from api.services.financial_aid_development_service import (
    FinancialAidDevelopmentService,
    FunderNotFoundError,
    FundingSourceNotFoundError,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWrite, AidWriteConflictError
from bunking.pocketbase_batch import BatchRequest, BatchRequestFailedError, BatchResult
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


async def test_each_group_names_the_program_families_its_pool_funds() -> None:
    """Final UX (money-funders.html, owner 10-09 star 19, rev1): Edit... picks pools, not program families, and its
    "Covers: Summer, Quest, Teen" line names what each pool covers. The families are the ones the season's rules
    send to the pool (`by_family`), the same set Set a Group... writes for it; none for a pool no session reaches."""
    out = await _service(_store()).funding_sources(YEAR)
    found = {g.key: list(g.families) for g in out.groups}
    assert found["camp_pool"] == ["quest", "summer"]
    for key, families in found.items():
        assert families == sorted(families), key
    stored = {f for g in out.groups for f in g.families}
    assert stored <= {"summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend"}


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
    assert out.group_change_warning == "Changing this re-places household-level lines on the next ledger sync."


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


def _mixed_funder() -> FakeDevelopmentStore:
    """One funder with an incentive description and a need-based one."""
    return FakeDevelopmentStore(
        source_rows=[
            replace(REGIONAL, grantor_key="regional_fund", incentive=True),
            replace(SPRING, incentive=False),
        ],
        grantor_rows=[FUND],
    )


async def test_a_group_only_funder_save_leaves_each_descriptions_incentive_flag() -> None:
    """Omitting incentive keeps each description's own flag: a mixed funder is not flattened."""
    store = _mixed_funder()
    out = await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn(group="weekend_pool"), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert all("incentive" not in (w.data or {}) for w in operation)
    assert all("implied_program_families" in (w.data or {}) for w in operation)
    assert out.incentive is None  # still mixed


async def test_an_incentive_flag_on_the_funder_sets_every_description() -> None:
    store = _mixed_funder()
    out = await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn(group="camp_pool", incentive=True), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert [str(w.record_id) for w in operation] == [SPRING.id]  # the flagged one is already True: no write
    assert all((w.data or {}).get("incentive") is True for w in operation)
    assert out.incentive is True


async def test_a_funder_save_that_changes_nothing_writes_nothing() -> None:
    store = _mixed_funder()
    await _service(store).save_funder(YEAR, "regional_fund", FundingSourceIn(group="camp_pool"), actor=DEVELOPMENT)
    assert store.operations == []


async def test_the_per_source_save_with_incentive_omitted_keeps_the_flag() -> None:
    store = FakeDevelopmentStore(source_rows=[replace(REGIONAL, incentive=True)])
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(group="weekend_pool"), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert "incentive" not in (write.data or {})
    assert out.incentive is True


# --- group: absent keeps, explicit null clears, a value sets (the same three-way rule as incentive) ---------------


async def test_a_source_save_without_a_group_keeps_its_families_and_sets_the_incentive() -> None:
    store = FakeDevelopmentStore(source_rows=[REGIONAL])
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn.model_validate({"incentive": True}), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert write.data == {"incentive": True}
    assert out.families == ["quest", "summer"]
    assert out.group == "camp_pool"


async def test_a_source_save_with_an_explicit_null_group_clears_the_families() -> None:
    store = FakeDevelopmentStore(source_rows=[REGIONAL])
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn.model_validate({"group": None}), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert write.data == {"implied_program_families": []}
    assert (out.group, out.needs_group) == (None, True)


async def test_a_source_save_with_a_group_value_sets_it() -> None:
    store = FakeDevelopmentStore(source_rows=[REGIONAL])
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn.model_validate({"group": "weekend_pool"}), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert set(write.data or {}) == {"implied_program_families"}
    assert out.group == "weekend_pool"


async def test_a_source_save_with_only_a_note_writes_nothing_and_logs_nothing() -> None:
    store = FakeDevelopmentStore(source_rows=[REGIONAL])
    await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn.model_validate({"note": "just a note"}), actor=DEVELOPMENT
    )
    assert store.operations == []
    assert store.log == []


def _single_group_funder() -> FakeDevelopmentStore:
    return FakeDevelopmentStore(
        source_rows=[
            replace(REGIONAL, grantor_key="regional_fund"),
            replace(SPRING, implied_program_families=("summer",)),
        ],
        grantor_rows=[FUND],
    )


async def test_a_funder_save_without_a_group_keeps_every_descriptions_families() -> None:
    store = _single_group_funder()
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn.model_validate({"incentive": True}), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert operation
    assert all(set(w.data or {}) == {"incentive"} for w in operation)


async def test_a_funder_save_with_an_explicit_null_group_clears_every_description() -> None:
    store = _single_group_funder()
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn.model_validate({"group": None}), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert all((w.data or {}).get("implied_program_families") == [] for w in operation)


async def test_a_funder_save_with_a_group_value_sets_it() -> None:
    store = _single_group_funder()
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn.model_validate({"group": "weekend_pool"}), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert all("implied_program_families" in (w.data or {}) for w in operation)


async def test_a_funder_save_with_only_a_note_writes_nothing_and_logs_nothing() -> None:
    store = _single_group_funder()
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn.model_validate({"note": "n"}), actor=DEVELOPMENT
    )
    assert store.operations == []
    assert store.log == []


# --- the season's lines and the last change (slice 4 ask 5, with slice 3 ask 2), and needs_group ---------------


def _posting(source_key: str, amount: float, effective: str = "") -> SimpleNamespace:
    """A live aid_postings row: an aid line posts negative; `effective` is the description after a reclassifying override."""
    return SimpleNamespace(source_key=source_key, effective_source_key=effective or source_key, amount=amount)


def _logged(source_id: str, log_id: str, actor: str, reason: str, created: str) -> SimpleNamespace:
    return SimpleNamespace(id=log_id, entity_id=source_id, actor=actor, reason=reason, created=created)


async def test_a_description_counts_the_lines_reclassified_onto_it_and_carries_its_last_change() -> None:
    store = _store()
    store.posting_rows = [
        _posting(
            "camp fa", -300.0, effective="regional grant"
        ),  # reclassified: the grant's description classifies it now
        _posting("regional grant", -200.0),
    ]
    store.change_rows = [
        _logged(REGIONAL.id, "log000000000001", DEVELOPMENT, "Funds the camp pool", "2027-02-10 10:00:00.000Z")
    ]
    out = await _service(store).funding_sources(YEAR)
    regional = next(s for s in out.sources if s.source_id == REGIONAL.id)
    assert (regional.lines, regional.amount) == (2, 500.0)
    assert regional.last_change == SourceChangeOut(
        by=DEVELOPMENT, at=datetime(2027, 2, 10, 10, 0, tzinfo=UTC), note="Funds the camp pool"
    )
    quiet = next(s for s in out.sources if s.source_id == YEARS_AT_CAMP.id)
    assert (quiet.lines, quiet.amount, quiet.last_change) == (0, 0.0, None)  # no line, never edited in the app


async def test_a_funder_row_sums_its_descriptions_lines_and_takes_the_later_change() -> None:
    """D159: the funder row stands for REGIONAL and SPRING together. Its lines and dollars are theirs summed, and its
    last change the later of theirs, whichever description it was made on."""
    store = _by_funder()
    store.posting_rows = [
        _posting("regional grant", -300.25),
        _posting("regional grant 2", -200.0),
        _posting("regional grant 2", -100.0),
    ]
    store.change_rows = [
        _logged(REGIONAL.id, "log000000000001", DEVELOPMENT, "First grouping", "2027-01-05 10:00:00.000Z"),
        _logged(SPRING.id, "log000000000002", "finance@example.com", "Later regrouping", "2027-02-10 10:00:00.000Z"),
    ]
    out = await _service(store).funding_sources(YEAR)
    row = next(r for r in out.rows if r.grantor_key == "regional_fund")
    assert [(d.lines, d.amount) for d in row.descriptions] == [(1, 300.25), (2, 300.0)]
    assert (row.lines, row.amount) == (3, 600.25)  # summed as Decimals, rounded once
    assert row.last_change == SourceChangeOut(
        by="finance@example.com", at=datetime(2027, 2, 10, 10, 0, tzinfo=UTC), note="Later regrouping"
    )


async def test_a_save_echo_leaves_the_season_facts_unset() -> None:
    """Only the list read counts the season; the PUT's answer carries the record's own facts and the screen re-reads."""
    store = _store()
    store.posting_rows = [_posting("regional grant", -200.0)]
    store.change_rows = [_logged(REGIONAL.id, "log000000000001", DEVELOPMENT, "First", "2027-01-05 10:00:00.000Z")]
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(group="weekend_pool", incentive=False), actor=DEVELOPMENT
    )
    assert (out.lines, out.amount, out.last_change) == (None, None, None)


async def test_the_camps_own_and_unclassified_rows_never_need_a_group() -> None:
    """D100's needs-a-group is an outside or incentive source with no group: the ledger's own rule, which the Sources
    chip and Today share. #2967 set it to `not families` for every section, so the camp's own rows read True."""
    store = _by_funder()
    store.source_rows.append(MYSTERY)
    out = await _service(store).funding_sources(YEAR)
    by_section = {r.section: r.needs_group for r in out.rows if r.section != "outside"}
    assert by_section == {"camp": False, "unclassified": False}
    assert next(r for r in out.rows if r.name == "Years-at-Camp Grant").needs_group is True  # outside, no group


def _vanished(pb: object, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
    raise BatchRequestFailedError(
        index=0, total=len(requests), request=requests[0], status=404, message="gone", field_errors={}, response=None
    )


async def test_a_funding_sources_write_that_lost_a_race_is_a_conflict_not_a_500() -> None:
    """DevelopmentRepository.commit let a refused batch through as BatchRequestFailedError: a 500. _reports_http already
    maps AidWriteConflictError to 409."""
    write = AidWrite(
        collection=AID_SOURCES,
        action="update",
        year=YEAR,
        record_id=REGIONAL.id,
        before={"implied_program_families": ["quest", "summer"]},
        data={"implied_program_families": ["summer"]},
    )
    with patch("bunking.financial_aid.change_log.send_batch", side_effect=_vanished):
        with pytest.raises(AidWriteConflictError) as refused:
            await DevelopmentRepository(MagicMock()).commit([write], actor=DEVELOPMENT)
    assert (refused.value.collection, refused.value.record_id, str(refused.value)) == (
        AID_SOURCES,
        REGIONAL.id,
        CONFLICT_MESSAGE,
    )


# --- Set a Group... as a multi-select (final UX, owner-approved mock option A): `groups` ------------------------------


async def _pool_families(key: str) -> list[str]:
    out = await _service(_store()).funding_sources(YEAR)
    return next(list(g.families) for g in out.groups if g.key == key)


async def test_two_picked_pools_store_the_union_of_the_families_each_funds() -> None:
    camp, weekend = await _pool_families("camp_pool"), await _pool_families("weekend_pool")
    assert camp
    assert weekend
    store = _store()
    out = await _service(store).save_funding_source(
        YEAR, YEARS_AT_CAMP.id, FundingSourceIn(groups=["weekend_pool", "camp_pool"]), actor=DEVELOPMENT
    )
    union = sorted({*camp, *weekend})
    assert out.families == union
    assert (out.group, out.group_label, out.needs_group, out.families_changed) == (None, "several groups", False, True)
    [[write]] = store.operations
    assert write.data == {"implied_program_families": union}


@pytest.mark.parametrize("cleared", [[], None], ids=["empty-list", "null"])
async def test_groups_empty_or_null_clears_the_families(cleared: list[str] | None) -> None:
    store = _store()
    out = await _service(store).save_funding_source(
        YEAR, REGIONAL.id, FundingSourceIn(groups=cleared), actor=DEVELOPMENT
    )
    assert (out.families, out.needs_group) == ([], True)
    [[write]] = store.operations
    assert write.data == {"implied_program_families": []}


async def test_an_unknown_pool_in_groups_is_refused() -> None:
    store = _store()
    with pytest.raises(ReportsRefusedError, match="budget pools"):
        await _service(store).save_funding_source(
            YEAR, REGIONAL.id, FundingSourceIn(groups=["camp_pool", "nowhere"]), actor=DEVELOPMENT
        )
    assert store.operations == []


async def test_a_picked_pool_no_program_funds_is_refused() -> None:
    """A pool the rules list but no program reaches has no families to point the source at (as `group` is today)."""
    store = _store()
    service = _service(store)
    real = await service._season_grouping(YEAR)
    hollow = replace(real, by_family={f: p for f, p in real.by_family.items() if p != "bmitzvah_pool"})
    with (
        patch.object(service, "_season_grouping", return_value=hollow),
        pytest.raises(ReportsRefusedError, match="No program"),
    ):
        await service.save_funding_source(
            YEAR, REGIONAL.id, FundingSourceIn(groups=["camp_pool", "bmitzvah_pool"]), actor=DEVELOPMENT
        )
    assert store.operations == []


async def test_groups_equal_to_the_pools_it_reaches_now_keep_the_narrower_families() -> None:
    """Finance's narrower setting (D100) survives a save that picks exactly the pools the source reaches now."""
    store = FakeDevelopmentStore(source_rows=[NARROW])
    out = await _service(store).save_funding_source(
        YEAR, NARROW.id, FundingSourceIn(groups=["camp_pool"], incentive=True), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert write.data == {"incentive": True}
    assert out.families == ["summer"]


async def test_groups_equal_to_the_several_pools_it_reaches_now_keep_its_families() -> None:
    store = FakeDevelopmentStore(source_rows=[SPLIT])
    await _service(store).save_funding_source(
        YEAR, SPLIT.id, FundingSourceIn(groups=["camp_pool", "weekend_pool"], incentive=True), actor=DEVELOPMENT
    )
    [[write]] = store.operations
    assert write.data == {"incentive": True}


async def test_a_funder_row_keeps_families_when_groups_equal_the_one_set_every_member_reaches() -> None:
    store = FakeDevelopmentStore(
        source_rows=[replace(REGIONAL, grantor_key="regional_fund"), SPRING], grantor_rows=[FUND]
    )
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn(groups=["camp_pool"], incentive=True), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert all(w.data == {"incentive": True} for w in operation)


async def test_a_funder_row_writes_the_union_of_the_picked_pools_to_every_member() -> None:
    camp, weekend = await _pool_families("camp_pool"), await _pool_families("weekend_pool")
    store = FakeDevelopmentStore(
        source_rows=[replace(REGIONAL, grantor_key="regional_fund"), SPRING], grantor_rows=[FUND]
    )
    await _service(store).save_funder(
        YEAR, "regional_fund", FundingSourceIn(groups=["camp_pool", "weekend_pool"]), actor=DEVELOPMENT
    )
    [operation] = store.operations
    assert {tuple((w.data or {})["implied_program_families"]) for w in operation} == {tuple(sorted({*camp, *weekend}))}


async def test_sending_both_group_and_groups_is_a_422() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="group"):
        FundingSourceIn(group="camp_pool", groups=["camp_pool"])
    with pytest.raises(ValidationError, match="group"):
        FundingSourceIn(group=None, groups=[])
    with pytest.raises(ValidationError):
        FundingSourceIn(groups=["x" * 61])
    with pytest.raises(ValidationError):
        FundingSourceIn(groups=["a"] * 25)
