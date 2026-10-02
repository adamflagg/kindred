"""The March bulk file (campership slice 3, ask 6; clean spec §8.3; D21, D73; owner ruling S3-7). Fictional only.
Prices under financial_aid_fakes.intake_rules(): Session 2 gives a tier-2 family Round 1 = 1,500."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, camper_name
from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_march_file import MarchFileService, march_rows, march_shares
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _posted, _service
from tests.unit.bunking.financial_aid.test_decision_budget import priced, view

EMMA = "reqemma00000001"  # Emma Johnson, household 1000001
LIAM = "reqliam00000001"  # Liam Garcia, household 1000002
OLIVIA = "reqoliv00000001"  # Olivia Chen, household 1000003
NOAH = "reqnoah00000001"  # household 1000005
FAMILY = "reqfami00000001"  # a household's own Family Camp request (no camper)


def _shares(store: FakeDecisionsStore) -> dict[str, tuple[PayerShareRecord, ...]]:
    return {rid: tuple(s for s in store.shares if s.request_id == rid) for rid in store.requests}


def _split_emma(store: FakeDecisionsStore) -> None:
    """Emma's request paid 60/40 by her household and a second home (1000004)."""
    store.shares = [
        *(s for s in store.shares if s.request_id != EMMA),
        share_row(EMMA, 1000001, "60"),
        share_row(EMMA, 1000004, "40"),
    ]


# --- the rows (pure) ---------------------------------------------------------------------------


def test_one_row_per_payer_share_at_its_whole_dollar_part_of_round_1() -> None:
    """S3-7: one row per payer share at that share's Round 1 decided amount; split_award's whole dollars add up to
    Round 1 exactly, the remainder on the applying household. An unsplit request is one row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _split_emma(store)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1501")),
        LIAM: priced(LIAM, 1000002, view(1, "needs_offer", decided="1200")),
    }
    found = march_shares(store.requests, priced_by_id, _shares(store))
    assert sorted((s.request_id, s.household_cm_id, s.amount, s.applicant, s.person_cm_id) for s in found) == [
        (EMMA, 1000001, Decimal(901), True, 1000011),
        (EMMA, 1000004, Decimal(600), False, 1000011),
        (LIAM, 1000002, Decimal(1200), True, 1000021),
    ]


def test_only_a_round_1_that_still_needs_its_offer_is_sent() -> None:
    """§8.3: over Needs an offer's Round 1 group. A posted Round 1 never goes again (D73: it would double-post),
    whatever its later rounds need; a held or undecided one has nothing to send."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_request(store, OLIVIA, household=1000003, person=1000031)
    seed_request(store, NOAH, household=1000005, person=1000051)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500")),
        LIAM: priced(LIAM, 1000002, view(1, "posted", locked="1500"), view(2, "needs_offer", ask="900", decided="300")),
        OLIVIA: priced(OLIVIA, 1000003, view(1, "held")),
        NOAH: priced(NOAH, 1000005, view(1, "not_decided")),
    }
    assert [s.request_id for s in march_shares(store.requests, priced_by_id, _shares(store))] == [EMMA]


def test_a_zero_round_1_is_a_zero_row() -> None:
    """Owner question 2 (default): $0 is a real zero (D74) and still needs its offer, so it is a $0 row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    priced_by_id = {EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="0"))}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), {1000011: ("Emma", "Johnson")})
    assert [(r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id) for r in rows] == [
        ("Emma", "Johnson", 0.0, 1000001, 1000011),
    ]


def test_a_household_request_is_a_row_with_no_camper_and_no_personal_id() -> None:
    """Owner question 1 (default): a Family Camp request is the household's, so its row names no camper and has no
    Personal Id (None); Primary Childhood ID is the household."""
    store = FakeDecisionsStore()
    seed_request(store, FAMILY, household=1000003, person=0, session=1000201)
    priced_by_id = {FAMILY: priced(FAMILY, 1000003, view(1, "needs_offer", decided="800"))}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), {1000011: ("Emma", "Johnson")})
    assert [(r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id) for r in rows] == [
        ("", "", 800.0, 1000003, None),
    ]


def test_rows_sort_by_camper_then_request_with_the_applying_household_first() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _split_emma(store)
    priced_by_id = {
        EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500")),
        LIAM: priced(LIAM, 1000002, view(1, "needs_offer", decided="1200")),
    }
    names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia")}
    rows = march_rows(march_shares(store.requests, priced_by_id, _shares(store)), names)
    assert [(r.request_id, r.camper_last, r.primary_childhood_id, r.total_award) for r in rows] == [
        (LIAM, "Garcia", 1000002, 1200.0),
        (EMMA, "Johnson", 1000001, 900.0),
        (EMMA, "Johnson", 1000004, 600.0),
    ]


def test_shares_that_do_not_split_leave_the_request_out() -> None:
    """Defensive: incomplete shares hold the request, so this can't reach the file; if it ever did, no guessed row."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "60")]
    priced_by_id = {EMMA: priced(EMMA, 1000001, view(1, "needs_offer", decided="1500"))}
    left_out: list[str] = []
    assert march_shares(store.requests, priced_by_id, _shares(store), left_out) == []
    assert left_out == [EMMA]  # counted, so the read's log line can say left_out=1


# --- CampMinder's names -------------------------------------------------------------------------


def test_a_campers_names_are_campminders_never_the_preferred_name() -> None:
    record = SimpleNamespace(cm_id=1000011, first_name=" Emma ", last_name="Johnson ", preferred_name="Em")
    assert camper_name(record) == ("Emma", "Johnson")
    assert camper_name(SimpleNamespace(cm_id=1000011, first_name=None, last_name="")) == ("", "")


@pytest.mark.asyncio
async def test_the_names_read_asks_persons_for_the_season_and_the_campers() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = [
        SimpleNamespace(cm_id=1000011, first_name="Emma", last_name="Johnson", preferred_name="")
    ]
    names = await FinancialAidDecisionsRepository(pb).fetch_camper_names(YEAR, [1000011])
    assert names == {1000011: ("Emma", "Johnson")}
    pb.collection.assert_called_with("persons")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert f"year = {YEAR}" in query["filter"]
    assert "1000011" in query["filter"]


# --- the read -----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_read_sends_each_share_of_every_round_1_offer_with_campminders_names() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    seed_request(store, OLIVIA, household=1000003, person=1000031, status="withdrawn")
    _split_emma(store)
    _posted(store, LIAM, 1, "1500")
    store.camper_names = {1000011: ("Emma", "Johnson"), 1000021: ("Liam", "Garcia"), 1000031: ("Olivia", "Chen")}
    out = await MarchFileService(_service(store), store).read(YEAR)
    assert out.year == YEAR
    assert [
        (r.request_id, r.camper_first, r.camper_last, r.total_award, r.primary_childhood_id, r.personal_id)
        for r in out.rows
    ] == [
        (EMMA, "Emma", "Johnson", 900.0, 1000001, 1000011),
        (EMMA, "Emma", "Johnson", 600.0, 1000004, 1000011),
    ]
