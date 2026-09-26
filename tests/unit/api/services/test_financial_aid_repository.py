"""Filter shapes and request validation for the campership ledger repository (sub-project 4)."""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid import (
    AidSourceUpdate,
    DispositionBulkLoad,
    DispositionRow,
    OverrideBulkLoad,
    OverrideRow,
)
from api.services import financial_aid_repository
from api.services.financial_aid_repository import FinancialAidRepository


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
    pb, calls = _pb()
    repo = FinancialAidRepository(pb)
    await repo.fetch_off_season_session_rows(2026, {11, 12})
    flt = str(calls[0]["filter"])
    assert flt.startswith("year = 2026 && is_reversed = false && session_cm_id > 0")
    assert "session_cm_id != 11" in flt
    assert "session_cm_id != 12" in flt
    calls.clear()
    assert await repo.fetch_off_season_session_rows(2026, set()) == []
    assert calls == []  # a season with no synced sessions reports nothing (SP1's rule)


@pytest.mark.asyncio
async def test_aid_like_read_looks_outside_the_two_aid_categories() -> None:
    pb, calls = _pb()
    await FinancialAidRepository(pb).fetch_aid_like_outside(2026, ["Regional Fund's Grant"])
    flt = str(calls[0]["filter"])
    assert "financial_category_cm_id != 3840" in flt
    assert "financial_category_cm_id != 19616" in flt
    assert "description ~ 'financial assistance'" in flt
    assert "description ~ 'grant'" in flt
    assert "description = 'Regional Fund\\'s Grant'" in flt
    assert "is_reversed = false" in flt


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
async def test_get_source_escapes_the_id() -> None:
    pb, calls = _pb()
    assert await FinancialAidRepository(pb).get_source("abc'def") is None
    assert calls[0]["filter"] == "id = 'abc\\'def'"


def test_override_row_must_place_or_reclassify() -> None:
    with pytest.raises(ValidationError):
        OverrideRow(transaction_cm_id=9001)
    assert OverrideRow(transaction_cm_id=9001, source_key_override="outside program award").program_family is None


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


def test_disposition_rows_are_unique_per_flag_and_name_a_real_flag_shape() -> None:
    row = DispositionRow(transaction_cm_id=9001, flag="aid_exceeds_fee", disposition="accepted_late_grant", note="n")
    with pytest.raises(ValidationError):
        DispositionBulkLoad(year=2026, rows=[row, row])
    with pytest.raises(ValidationError):
        DispositionRow(transaction_cm_id=9001, flag="Not A Flag", disposition="accepted_other", note="n")
    with pytest.raises(ValidationError):
        DispositionRow(transaction_cm_id=9001, flag="aid_exceeds_fee", disposition="accepted_other", note="")


def test_only_the_camps_own_aid_counts_toward_the_budget() -> None:
    # Owner ruling 2026-09-25: every outside grant and fund is external to the budget.
    base = {"source_name": "X", "counts_as_aid": True, "note": "n"}
    assert AidSourceUpdate(**base, source_family="camp_fa", funder_type="camp", counts_toward_budget=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="jfam_incentive", funder_type="incentive", counts_toward_budget=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="named_fund", funder_type="outside", counts_toward_budget=True)


def test_full_coverage_is_an_outside_source_attribute() -> None:
    base = {"source_name": "X", "counts_as_aid": True, "counts_toward_budget": False, "note": "n"}
    assert AidSourceUpdate(**base, source_family="other_outside", funder_type="outside").full_coverage is False
    assert AidSourceUpdate(**base, source_family="other_outside", funder_type="outside", full_coverage=True)
    with pytest.raises(ValidationError):
        AidSourceUpdate(**base, source_family="camp_fa", funder_type="camp", full_coverage=True)
