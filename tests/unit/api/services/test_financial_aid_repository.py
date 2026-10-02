"""Filter shapes and request validation for the campership ledger repository (sub-project 4)."""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid import (
    AidSourceUpdate,
    OverrideBulkLoad,
    OverrideRow,
)
from api.services import financial_aid_repository
from api.services.financial_aid_repository import HOUSEHOLD_CHUNK, FinancialAidRepository


def _pb(rows: list[object] | None = None) -> tuple[MagicMock, list[dict[str, object]]]:
    calls: list[dict[str, object]] = []
    pb = MagicMock()

    def get_full_list(batch: int, query_params: dict[str, object]) -> list[object]:
        calls.append(query_params)
        return list(rows or [])

    pb.collection.return_value.get_full_list.side_effect = get_full_list
    return pb, calls


@pytest.mark.asyncio
async def test_household_filtered_postings_chunk_ids_keep_the_year_and_read_live_rows() -> None:
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_postings(2026, list(range(1, 251)))
    assert len(calls) == 3  # 100 + 100 + 50
    assert all(str(c["filter"]).startswith("year = 2026 && is_reversed = false && (household_cm_id = ") for c in calls)
    assert all(c["sort"] == "id" for c in calls)


@pytest.mark.asyncio
async def test_history_reads_include_reversed_rows() -> None:
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_postings(2026, include_reversed=True)
    assert calls[0]["filter"] == "year = 2026"


@pytest.mark.asyncio
async def test_reversed_aid_reads_only_reversed_rows_in_the_two_aid_categories() -> None:
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_reversed_aid(2026, [100])
    flt = str(calls[0]["filter"])
    assert "is_reversed = true" in flt
    assert "financial_category_cm_id = 3840" in flt
    assert "financial_category_cm_id = 19616" in flt
    assert "3839" not in flt
    assert "household_cm_id = 100" in flt


@pytest.mark.asyncio
async def test_off_season_rows_exclude_the_seasons_own_sessions() -> None:
    rows: list[object] = [
        SimpleNamespace(cm_id=c, session_cm_id=s, amount=-1.0) for c, s in ((1, 11), (2, 12), (3, 99))
    ]
    pb, calls = _pb(rows)
    repo = FinancialAidRepository(pb)
    got = await repo.fetch_off_season_session_rows(2026, {11, 12})
    assert [int(r.cm_id) for r in got] == [3]
    assert str(calls[0]["filter"]) == "year = 2026 && is_reversed = false && session_cm_id > 0"
    calls.clear()
    assert await repo.fetch_off_season_session_rows(2026, set()) == []
    assert calls == []  # a season with no synced sessions reports nothing (SP1's rule)


@pytest.mark.asyncio
async def test_off_season_filter_stays_bounded_however_many_sessions_the_season_holds() -> None:
    # One `!=` clause per session would cross PocketBase's 3500-character filter
    # limit at ~120 sessions and turn /data-quality into a 500.
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_off_season_session_rows(2026, set(range(1_000_000, 1_000_300)))
    assert len(str(calls[0]["filter"])) < financial_aid_repository.AID_LIKE_FILTER_BUDGET


@pytest.mark.asyncio
async def test_aid_like_read_looks_outside_the_two_aid_categories() -> None:
    # Item 1 fix (kindred SP4 final review): the generic aid-word terms and the
    # per-description equality terms are now separate PocketBase queries (the
    # equality terms are chunked so aid_sources's global, ever-growing
    # description list can never build a single filter over PocketBase's
    # ~3500-char limit). This pins the NEW query shape -- the old expectation
    # that both live in calls[0] was the bug (a single one-filter-per-call
    # shape does not scale), not something to preserve.
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_aid_like_outside(2026, ["Regional Fund's Grant"])
    assert len(calls) == 2  # the generic aid-word query, then one equality-term chunk
    word_filter, equality_filter = (str(c["filter"]) for c in calls)
    assert "financial_category_cm_id != 3840" in word_filter
    assert "financial_category_cm_id != 19616" in word_filter
    assert "description ~ 'financial assistance'" in word_filter
    assert "description ~ 'grant'" in word_filter
    assert "is_reversed = false" in word_filter
    assert "description = 'Regional Fund\\'s Grant'" in equality_filter
    assert "is_reversed = false" in equality_filter


@pytest.mark.asyncio
async def test_aid_like_outside_chunks_the_equality_filter_and_merges_results() -> None:
    # aid_sources is global, so once staff classify roughly 60 descriptions as
    # aid, one filter holding a `description = '...'` term for every one of
    # them crossed PocketBase v0.40.4's ~3500-char filter limit
    # (tools/search/provider.go:31) and /data-quality 500'd. 100 fictional
    # descriptions here is comfortably past that point.
    descriptions = [f"Example Camp Regional Grant Program Number {i:03d}" for i in range(100)]

    calls: list[dict[str, object]] = []
    pb = MagicMock()

    def get_full_list(batch: int, query_params: dict[str, object]) -> list[object]:
        calls.append(query_params)
        flt = str(query_params["filter"])
        rows: list[object] = []
        for i, d in enumerate(descriptions):
            if f"description = '{d}'" in flt:
                rows.append(SimpleNamespace(cm_id=9000 + i, financial_category_cm_id=3839, description=d, amount=-10))
        if "description ~ 'grant'" in flt:
            # A keyword-matched row every filter's word clause also matches --
            # exercises cross-query dedup by cm_id.
            rows.append(
                SimpleNamespace(cm_id=9000, financial_category_cm_id=3839, description=descriptions[0], amount=-10)
            )
        return rows

    pb.collection.return_value.get_full_list.side_effect = get_full_list

    rows = await FinancialAidRepository(pb).fetch_aid_like_outside(2026, descriptions)

    assert len(calls) > 1  # actually chunked, not one giant filter
    assert all(len(str(c["filter"])) <= 3500 for c in calls)
    assert {int(r.cm_id) for r in rows} == {9000 + i for i in range(100)}  # every description's row, exactly once


@pytest.mark.asyncio
async def test_fa_requests_take_the_household_cm_id_from_the_expanded_relation() -> None:
    row = SimpleNamespace(
        summer_amount_requested=1200,
        fc_amount_requested=0,
        tbm_amount_requested=None,
        expand={"household": SimpleNamespace(cm_id=100)},
    )
    pb, _ = _pb([row])
    got = await FinancialAidRepository(pb).fetch_fa_requests(2026)
    assert [(r.household_cm_id, r.summer, r.family_camp, r.bmitzvah) for r in got] == [(100, 1200.0, 0.0, 0.0)]


@pytest.mark.asyncio
async def test_user_names_read_only_people_and_only_their_names() -> None:
    pb, calls = _pb([SimpleNamespace(email="registrar@example.com", name="Test User")])
    out = await FinancialAidRepository(pb).fetch_user_names({"registrar@example.com", "system:ledger", ""})
    assert out == {"registrar@example.com": "Test User"}
    (call,) = calls
    assert call["filter"] == "email = 'registrar@example.com'"
    assert call["fields"] == "email,name"


@pytest.mark.asyncio
async def test_fa_requests_for_some_households_reads_only_theirs() -> None:
    """Spec §10's known cost: /households/{id} re-read the whole season's FA mirror on every call."""
    pb, calls = _pb([])
    await FinancialAidRepository(pb).fetch_fa_requests(2026, [100, 200])
    (call,) = calls
    assert "(household.cm_id = 100 || household.cm_id = 200)" in str(call["filter"])
    assert str(call["filter"]).startswith("year = 2026 && ")


@pytest.mark.asyncio
async def test_fa_requests_for_many_households_are_chunked_and_concatenated() -> None:
    """More households than one HOUSEHOLD_CHUNK make several reads, each under the filter limit, whose rows join."""
    row = SimpleNamespace(
        summer_amount_requested=1200,
        fc_amount_requested=0,
        tbm_amount_requested=None,
        expand={"household": SimpleNamespace(cm_id=100)},
    )
    pb, calls = _pb([row])
    ids = [1_000_000 + i for i in range(HOUSEHOLD_CHUNK * 2 + 1)]
    got = await FinancialAidRepository(pb).fetch_fa_requests(2026, ids)
    assert len(calls) == 3
    assert all(len(str(c["filter"])) <= 3500 for c in calls)
    assert len(got) == 3  # one fake row per call, concatenated


@pytest.mark.asyncio
async def test_fa_requests_for_no_households_reads_nothing() -> None:
    pb, calls = _pb([])
    assert await FinancialAidRepository(pb).fetch_fa_requests(2026, []) == []
    assert calls == []


def _person_row(pid: str, cm: int, household: int, primary: int = 0, alternate: int = 0) -> SimpleNamespace:
    expand: dict[str, object] = {"household": SimpleNamespace(cm_id=household)}
    if primary:
        expand["primary_childhood_household"] = SimpleNamespace(cm_id=primary)
    if alternate:
        expand["alternate_childhood_household"] = SimpleNamespace(cm_id=alternate)
    return SimpleNamespace(id=pid, cm_id=cm, household_id=household, expand=expand)


@pytest.mark.asyncio
async def test_household_persons_by_household_reads_eight_households_a_query_and_splits_them_back() -> None:
    """SP6-core T7: one query per household cost about 65 ms (a 100-household class took ~7 s), and
    PocketBase rejects an OR filter over 25 households' relation joins (400). Eight a query is the
    measured safe size. Each person lands under every requested household they belong to: their own,
    or a primary or alternate childhood household."""
    rows: list[object] = [
        _person_row("p1", 1001, household=1, primary=2),
        _person_row("p2", 1002, household=150, alternate=3),
        _person_row("p3", 1003, household=999),
    ]
    pb, calls = _pb(rows)
    got = await FinancialAidRepository(pb).fetch_household_persons_by_household(2026, list(range(1, 21)))
    assert len(calls) == 3  # 8 + 8 + 4
    assert all(str(c["filter"]).startswith("year = 2026 && (") for c in calls)
    assert all("primary_childhood_household.cm_id = " in str(c["filter"]) for c in calls)
    assert all(c["expand"] == "household,primary_childhood_household,alternate_childhood_household" for c in calls)
    assert {h: [int(p.cm_id) for p in people] for h, people in got.items()} == {1: [1001], 2: [1001], 3: [1002]}


@pytest.mark.asyncio
async def test_get_source_escapes_the_id() -> None:
    pb, calls = _pb()
    assert await FinancialAidRepository(pb).get_source("abc'def") is None
    assert calls[0]["filter"] == "id = 'abc\\'def'"


def test_override_row_must_place_or_reclassify() -> None:
    with pytest.raises(ValidationError):
        OverrideRow(transaction_cm_id=9001)
    assert OverrideRow(transaction_cm_id=9001, source_key_override="outside program award").program_family is None


def test_override_row_source_key_override_is_bounded_at_5000() -> None:
    """Matches aid_sources.description_key (migration 1500000196), the row a
    reclassification targets -- not the 500-char cap early drafts of
    1500000199 used. Before first deploy, so raising it here needs no
    follow-up migration."""
    assert OverrideRow(transaction_cm_id=9001, source_key_override="x" * 5000).source_key_override == "x" * 5000
    with pytest.raises(ValidationError):
        OverrideRow(transaction_cm_id=9001, source_key_override="x" * 5001)


def test_bulk_load_rejects_a_transaction_listed_twice() -> None:
    with pytest.raises(ValidationError, match="once per load"):
        OverrideBulkLoad(
            year=2026,
            source="staff",
            reason="Reviewed placements",
            rows=[
                OverrideRow(transaction_cm_id=9001, program_family="summer"),
                OverrideRow(transaction_cm_id=9001, program_family="teen"),
            ],
        )


def test_an_override_load_needs_a_reason() -> None:
    # Spec §14.4: a reason is required for overrides. One per load, logged on every row without its own note.
    rows = [OverrideRow(transaction_cm_id=9001, program_family="summer")]
    assert OverrideBulkLoad(year=2026, source="staff", reason="Reviewed placements", rows=rows).reason
    with pytest.raises(ValidationError):
        OverrideBulkLoad.model_validate({"year": 2026, "source": "staff", "rows": [r.model_dump() for r in rows]})
    with pytest.raises(ValidationError):
        OverrideBulkLoad(year=2026, source="staff", reason="   ", rows=rows)


def test_the_repository_is_read_only() -> None:
    # Every write goes through 4a's commit_aid_writes (Task 12), never a repository write then a log.
    writers = [name for name in vars(FinancialAidRepository) if name.split("_")[0] in {"create", "update", "delete"}]
    assert writers == []
    # Belt and suspenders: no write call anywhere in the module's source, not just its method names.
    source = inspect.getsource(financial_aid_repository)
    assert ".create(" not in source
    assert ".update(" not in source
    assert ".delete(" not in source


def test_only_the_camps_own_aid_counts_toward_the_budget() -> None:
    # Owner ruling 2026-09-25: every outside grant and fund is external to the budget.
    base = {"source_name": "X", "counts_as_aid": True, "note": "n"}
    assert AidSourceUpdate(**base, source_family="camp_fa", funder_type="camp", counts_toward_budget=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="jfam_incentive", funder_type="incentive", counts_toward_budget=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="named_fund", funder_type="outside", counts_toward_budget=True)


def test_counts_toward_budget_requires_counts_as_aid() -> None:
    # Item 5 (final review, ruling): counting toward the budget while not even
    # counting as aid is incoherent, whatever the source family.
    base = {"source_name": "X", "note": "n", "source_family": "camp_fa", "funder_type": "camp"}
    assert AidSourceUpdate(**base, counts_as_aid=True, counts_toward_budget=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, counts_as_aid=False, counts_toward_budget=True)


def test_full_coverage_is_not_a_source_attribute() -> None:
    """Owner ruling 2026-09-28: full_coverage is a grantor fact on aid_grantors now. A client
    still sending it on a classification is refused, not silently ignored."""
    base = {"source_name": "X", "counts_as_aid": True, "counts_toward_budget": False, "note": "n"}
    assert not hasattr(AidSourceUpdate(**base, source_family="other_outside", funder_type="outside"), "full_coverage")
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="other_outside", funder_type="outside", full_coverage=True)  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_user_names_are_keyed_by_lowercased_email() -> None:
    pb, _ = _pb([SimpleNamespace(email="Registrar@Example.com", name="Test User")])
    out = await FinancialAidRepository(pb).fetch_user_names({"REGISTRAR@example.com"})
    assert out == {"registrar@example.com": "Test User"}


@pytest.mark.asyncio
async def test_user_names_query_both_the_original_and_lowercased_email() -> None:
    """PocketBase's `=` is case-sensitive: a user stored as Registrar@Example.com is only found by that string."""
    pb, calls = _pb([SimpleNamespace(email="Registrar@Example.com", name="Test User")])
    await FinancialAidRepository(pb).fetch_user_names({"Registrar@Example.com"})
    (call,) = calls
    assert "email = 'Registrar@Example.com'" in str(call["filter"])
    assert "email = 'registrar@example.com'" in str(call["filter"])
