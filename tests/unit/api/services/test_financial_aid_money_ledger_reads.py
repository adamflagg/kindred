"""Money > Ledger's line read (campership slice 3, ask 1): every aid_postings line, every funder. Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, ledger_line
from api.services.financial_aid_to_place import MISMATCH_FLAG, LineDetail
from tests.unit.api.services.decisions_fakes import seed_line
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.to_place_fakes import QUEST_KEY, FakeToPlaceStore, seed_grant_line

RECORD = SimpleNamespace(
    transaction_cm_id=9101,
    household_cm_id=1000001,
    person_cm_id=0,
    amount=-250,
    post_date="2027-03-08 18:00:00.000Z",
    is_reversed=False,
    reversal_date="",
    attributed_person_cm_id=0,
    attributed_session_cm_id=0,
    program_family="summer",
    effective_source_key="summer program grant",
    funder_type="outside",
    source_family="other_outside",
    flags=[MISMATCH_FLAG],
    created="2027-03-09 06:00:00.000Z",
    updated="2027-03-09 06:00:00.000Z",
)


def test_any_aid_postings_record_becomes_a_ledger_line_with_its_classification() -> None:
    line = ledger_line(RECORD)
    assert (line.funder_type, line.source_key, line.source_family, line.flags) == (
        "outside",
        "summer program grant",
        "other_outside",
        (MISMATCH_FLAG,),
    )
    assert (line.line.amount, line.line.recorded_at) == (Decimal(250), datetime(2027, 3, 9, 6, 0, tzinfo=UTC))
    blank = ledger_line(SimpleNamespace(**{**vars(RECORD), "funder_type": "", "source_family": "", "flags": None}))
    assert (blank.funder_type, blank.source_family, blank.flags) == ("unknown", "unclassified", ())


@pytest.mark.asyncio
async def test_the_read_asks_for_every_funder_live_and_reversed_with_the_recorded_times() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [RECORD]
    lines = await FinancialAidDecisionsRepository(pb).fetch_ledger_lines(YEAR)
    assert [ln.line.transaction_cm_id for ln in lines] == [9101]
    pb.collection.assert_called_with("aid_postings")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["filter"] == f"year = {YEAR}"  # every funder type, live and reversed
    assert query["sort"] == "transaction_cm_id,id"
    assert {"funder_type", "source_family", "flags", "created", "updated", "effective_source_key"} <= set(
        query["fields"].split(",")
    )


@pytest.mark.asyncio
async def test_the_fake_reads_its_camp_lines_with_their_flags_then_the_other_funders() -> None:
    store = FakeToPlaceStore()
    seed_line(store, 9001, "1500")
    store.details[9001] = LineDetail(9001, QUEST_KEY, (MISMATCH_FLAG,))
    seed_grant_line(store, 9101, "250", household=1000004)
    lines = await store.fetch_ledger_lines(YEAR)
    assert [(ln.line.transaction_cm_id, ln.funder_type, ln.source_key, ln.flags) for ln in lines] == [
        (9001, "camp", QUEST_KEY, (MISMATCH_FLAG,)),
        (9101, "outside", "summer program grant", ()),
    ]
    assert (lines[1].line.household_cm_id, lines[1].line.amount) == (1000004, Decimal(250))
