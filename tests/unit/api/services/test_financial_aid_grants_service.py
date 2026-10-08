"""Grants service (sub-project 6-core): the grantor directory, the register read, placements
and commitments. Fictional data only; every write runs the real 4a helper over a fake batch."""

from __future__ import annotations

import asyncio
from collections.abc import Collection
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid_grants import (
    CamperSuggestionOut,
    CommitmentIn,
    GrantorCreate,
    GrantorRetireIn,
    GrantorSave,
    GrantRowOut,
    GrantsResponse,
    PlaceGrantsIn,
    WithdrawIn,
)
from api.services.financial_aid_grants_service import (
    GrantorInUseError,
    GrantorKeyTakenError,
    GrantorStateError,
    GrantsService,
    OneGrantsLoad,
)
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from bunking.financial_aid.change_log import CONFLICT_MESSAGE, AidWriteConflictError
from bunking.pocketbase_batch import BatchRequest, BatchRequestFailedError, BatchResult
from tests.unit.api.services.aid_commit_spy import AidCommitSpy, spy_on_commits
from tests.unit.api.services.to_place_fakes import FakeLabels

ACTOR = "finance@example.com"
SERVICE = "api.services.financial_aid_grants_service"


def _grantor(**kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "gra000000000001",
        "key": "regional_fund",
        "name": "Regional Fund",
        "aliases": ["The Regional"],
        "full_coverage": False,
        "covers_canteen": "unknown",
        "pays_after_camp_aid": False,
        "eligibility": "",
        "contacts": "",
        "note": "",
        "retired_at": "",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _source(key: str, grantor_key: str = "", **kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": f"src-{key}",
        "description_key": key,
        "description": key.title(),
        "source_name": key,
        "source_family": "other_outside",
        "funder_type": "outside",
        "counts_as_aid": True,
        "counts_toward_budget": False,
        "implied_program_families": [],
        "classified_by": "config_file",
        "note": "",
        "grantor_key": grantor_key,
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _repo(**values: Any) -> MagicMock:
    repo = MagicMock()
    repo.pb = MagicMock()
    repo.fetch_grantors = AsyncMock(return_value=values.get("grantors", []))
    repo.get_grantor = AsyncMock(return_value=values.get("grantor"))
    repo.fetch_sources = AsyncMock(return_value=values.get("sources", []))
    repo.fetch_open_commitments_naming = AsyncMock(return_value=values.get("open_commitments", []))
    return repo


def _service(repo: MagicMock) -> tuple[GrantsService, AidCommitSpy]:
    spy = spy_on_commits(SERVICE)
    patch(f"{SERVICE}.current_season_year", AsyncMock(return_value=2031)).start()
    return GrantsService(repo), spy


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _create(**kw: Any) -> GrantorCreate:
    base: dict[str, Any] = {"key": "regional_fund", "name": "Regional Fund", "note": "Added from the 2031 grant list"}
    base.update(kw)
    return GrantorCreate(**base)


def _save(**kw: Any) -> GrantorSave:
    base: dict[str, Any] = {"name": "Regional Fund", "aliases": ["The Regional"], "note": "Finance review"}
    base.update(kw)
    return GrantorSave(**base)


# --- the directory --------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_grantors_shows_each_grantors_descriptions_from_aid_sources() -> None:
    repo = _repo(
        grantors=[_grantor(), _grantor(id="gra2", key="city_fund", name="City Fund")],
        sources=[
            _source("regional grant - north", "regional_fund"),
            _source("regional grant - south", "regional_fund"),
            _source("city grant"),
        ],
    )
    service, _ = _service(repo)
    out = await service.list_grantors()
    by_key = {g.key: g for g in out.grantors}
    assert [d.description_key for d in by_key["regional_fund"].descriptions] == [
        "regional grant - north",
        "regional grant - south",
    ]
    assert by_key["city_fund"].descriptions == []
    assert [g.name for g in out.grantors] == ["City Fund", "Regional Fund"]  # sorted by name


@pytest.mark.asyncio
async def test_create_grantor_writes_the_record_and_its_log_row_together() -> None:
    repo = _repo()
    service, spy = _service(repo)
    out = await service.create_grantor(_create(full_coverage=True), ACTOR)
    assert out.key == "regional_fund"
    assert out.full_coverage is True
    assert out.covers_canteen == "unknown"
    (write,) = spy.writes
    assert write.collection == "aid_grantors"
    assert write.action == "create"
    assert write.entity_id == "regional_fund"
    assert write.year == 2031
    assert write.data is not None
    assert write.data["covers_canteen"] == "unknown"
    assert spy.kwargs["actor"] == ACTOR
    assert spy.kwargs["reason"] == "Added from the 2031 grant list"


@pytest.mark.asyncio
async def test_create_grantor_refuses_a_key_already_taken() -> None:
    service, spy = _service(_repo(grantor=_grantor()))
    with pytest.raises(GrantorKeyTakenError):
        await service.create_grantor(_create(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_save_grantor_logs_only_the_changed_fields() -> None:
    service, spy = _service(_repo(grantor=_grantor()))
    out = await service.save_grantor("regional_fund", _save(full_coverage=True, covers_canteen="yes"), ACTOR)
    assert out.full_coverage is True
    assert out.covers_canteen == "yes"
    (write,) = spy.writes
    assert write.action == "update"
    assert write.record_id == "gra000000000001"
    assert write.entity_id == "regional_fund"
    (log,) = spy.log_rows()
    assert set(log["after"]) == {"full_coverage", "covers_canteen"}


@pytest.mark.asyncio
async def test_saving_an_unchanged_grantor_writes_nothing() -> None:
    service, spy = _service(_repo(grantor=_grantor()))
    await service.save_grantor("regional_fund", _save(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_save_grantor_of_an_unknown_key_is_not_found() -> None:
    service, _ = _service(_repo(grantor=None))
    with pytest.raises(FinancialAidNotFoundError):
        await service.save_grantor("nobody", _save(), ACTOR)


# --- retiring a grantor (owner ruling 2026-10-01) ----------------------------------------

RETIRED_AT = "2031-02-01 18:30:00.000Z"
NOW = datetime(2031, 2, 1, 18, 30, tzinfo=UTC)


def _retire(reason: str = "Folded into the regional fund") -> GrantorRetireIn:
    return GrantorRetireIn(reason=reason)


def _clocked(repo: MagicMock) -> tuple[GrantsService, AidCommitSpy]:
    spy = spy_on_commits(SERVICE)
    patch(f"{SERVICE}.current_season_year", AsyncMock(return_value=2031)).start()
    return GrantsService(repo, clock=lambda: NOW), spy


@pytest.mark.asyncio
async def test_retiring_an_unused_grantor_stamps_retired_at_and_logs_the_reason() -> None:
    service, spy = _clocked(_repo(grantor=_grantor()))
    out = await service.retire_grantor("regional_fund", _retire(), ACTOR)
    assert out.retired_at == RETIRED_AT
    assert out.key == "regional_fund"
    (write,) = spy.writes
    assert write.collection == "aid_grantors"
    assert write.action == "update"
    assert write.record_id == "gra000000000001"
    assert write.entity_id == "regional_fund"
    assert write.log_action == "retire"
    assert write.year == 2031
    assert write.data == {"retired_at": RETIRED_AT, "note": "Folded into the regional fund"}
    assert spy.kwargs["reason"] == "Folded into the regional fund"
    assert spy.kwargs["require_reason"] is True
    assert spy.kwargs["actor"] == ACTOR
    (log,) = spy.log_rows()
    assert log["action"] == "retire"
    assert log["before"] == {"retired_at": ""}
    assert log["after"] == {"retired_at": RETIRED_AT}
    assert log["reason"] == "Folded into the regional fund"


@pytest.mark.asyncio
async def test_a_grantor_a_description_still_maps_to_is_not_retired() -> None:
    repo = _repo(
        grantor=_grantor(),
        sources=[
            _source("regional grant - north", "regional_fund"),
            _source("regional grant - south", "regional_fund"),
            _source("city grant", "city_fund"),
        ],
    )
    service, spy = _clocked(repo)
    with pytest.raises(GrantorInUseError) as caught:
        await service.retire_grantor("regional_fund", _retire(), ACTOR)
    assert (caught.value.descriptions, caught.value.grants) == (2, 0)
    assert str(caught.value) == (
        "Regional Fund can't be retired yet: 2 CampMinder descriptions still map to it. "
        "Map them to another grantor first."
    )
    assert not spy.called


@pytest.mark.asyncio
async def test_a_grantor_an_open_grant_names_is_not_retired() -> None:
    open_grant = SimpleNamespace(id="com000000000001", grantor_key="regional_fund", status="open")
    service, spy = _clocked(_repo(grantor=_grantor(), open_commitments=[open_grant]))
    with pytest.raises(GrantorInUseError) as caught:
        await service.retire_grantor("regional_fund", _retire(), ACTOR)
    assert (caught.value.descriptions, caught.value.grants) == (0, 1)
    assert str(caught.value) == (
        "Regional Fund can't be retired yet: 1 open grant still names it. "
        "Move it to another grantor or withdraw it first."
    )
    assert not spy.called


@pytest.mark.asyncio
async def test_a_grantor_in_use_both_ways_says_both() -> None:
    commitments = [SimpleNamespace(id=f"com00000000000{i}", grantor_key="regional_fund") for i in (1, 2)]
    repo = _repo(grantor=_grantor(), sources=[_source("regional grant", "regional_fund")], open_commitments=commitments)
    service, spy = _clocked(repo)
    with pytest.raises(GrantorInUseError) as caught:
        await service.retire_grantor("regional_fund", _retire(), ACTOR)
    assert str(caught.value) == (
        "Regional Fund can't be retired yet: 1 CampMinder description still maps to it, "
        "and 2 open grants still name it. Map the description to another grantor and move or withdraw "
        "the grants first."
    )
    assert not spy.called


@pytest.mark.asyncio
async def test_the_in_use_check_asks_for_this_grantors_open_grants() -> None:
    repo = _repo(grantor=_grantor())
    service, _ = _clocked(repo)
    await service.retire_grantor("regional_fund", _retire(), ACTOR)
    repo.fetch_open_commitments_naming.assert_awaited_once_with("regional_fund")


@pytest.mark.asyncio
async def test_retiring_a_retired_grantor_is_refused_and_logs_nothing() -> None:
    service, spy = _clocked(_repo(grantor=_grantor(retired_at=RETIRED_AT)))
    with pytest.raises(GrantorStateError, match=r"^Regional Fund is already retired$"):
        await service.retire_grantor("regional_fund", _retire(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_retiring_an_unknown_grantor_is_not_found() -> None:
    service, spy = _clocked(_repo(grantor=None))
    with pytest.raises(FinancialAidNotFoundError):
        await service.retire_grantor("nobody", _retire(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_unretiring_clears_retired_at_and_logs_the_reason() -> None:
    service, spy = _clocked(_repo(grantor=_grantor(retired_at=RETIRED_AT)))
    out = await service.unretire_grantor("regional_fund", _retire("Retired by mistake"), ACTOR)
    assert out.retired_at == ""
    (write,) = spy.writes
    assert write.log_action == "unretire"
    assert write.data == {"retired_at": "", "note": "Retired by mistake"}
    assert spy.kwargs["require_reason"] is True
    (log,) = spy.log_rows()
    assert log["action"] == "unretire"
    assert log["before"] == {"retired_at": RETIRED_AT}
    assert log["after"] == {"retired_at": ""}


@pytest.mark.asyncio
async def test_unretiring_an_active_grantor_is_refused_and_logs_nothing() -> None:
    service, spy = _clocked(_repo(grantor=_grantor()))
    with pytest.raises(GrantorStateError, match=r"^Regional Fund isn't retired$"):
        await service.unretire_grantor("regional_fund", _retire(), ACTOR)
    assert not spy.called


def test_a_retire_reason_is_required() -> None:
    with pytest.raises(ValidationError):
        GrantorRetireIn(reason="   ")
    with pytest.raises(ValidationError):
        GrantorRetireIn()  # type: ignore[call-arg]


@pytest.mark.asyncio
async def test_the_directory_hides_retired_grantors_unless_asked() -> None:
    repo = _repo(
        grantors=[_grantor(), _grantor(id="gra2", key="old_fund", name="Old Fund", retired_at=RETIRED_AT)],
    )
    service, _ = _service(repo)
    assert [g.key for g in (await service.list_grantors()).grantors] == ["regional_fund"]
    every = (await service.list_grantors(include_retired=True)).grantors
    assert [(g.key, g.retired_at) for g in every] == [("old_fund", RETIRED_AT), ("regional_fund", "")]


@pytest.mark.asyncio
async def test_a_retired_grantors_key_is_still_taken() -> None:
    service, spy = _service(_repo(grantor=_grantor(retired_at=RETIRED_AT)))
    with pytest.raises(GrantorKeyTakenError, match="retired; unretire it instead"):
        await service.create_grantor(_create(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_a_retired_grantor_can_still_be_saved_and_reads_back_retired() -> None:
    service, spy = _service(_repo(grantor=_grantor(retired_at=RETIRED_AT)))
    out = await service.save_grantor("regional_fund", _save(contacts="Archive copy"), ACTOR)
    assert out.retired_at == RETIRED_AT
    (log,) = spy.log_rows()
    assert set(log["after"]) == {"contacts"}


def test_covers_canteen_is_recorded_only_for_a_full_coverage_grantor() -> None:
    with pytest.raises(ValidationError, match="full-coverage"):
        _save(covers_canteen="no")
    assert _save(full_coverage=True, covers_canteen="no").covers_canteen == "no"
    assert _save(covers_canteen="unknown").covers_canteen == "unknown"


@pytest.mark.asyncio
async def test_a_grantor_records_that_it_pays_after_camp_aid() -> None:
    """D143: the pays-after fact round-trips like the other grantor facts: written on create,
    logged when it changes, and read back from the record."""
    service, spy = _service(_repo())
    out = await service.create_grantor(_create(full_coverage=True, pays_after_camp_aid=True), ACTOR)
    assert out.pays_after_camp_aid is True
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["pays_after_camp_aid"] is True

    service, spy = _service(_repo(grantor=_grantor(full_coverage=True)))
    await service.save_grantor("regional_fund", _save(full_coverage=True, pays_after_camp_aid=True), ACTOR)
    (log,) = spy.log_rows()
    assert set(log["after"]) == {"pays_after_camp_aid"}

    service, _ = _service(_repo(grantors=[_grantor(full_coverage=True, pays_after_camp_aid=True)]))
    listed = await service.list_grantors()
    assert [g.pays_after_camp_aid for g in listed.grantors] == [True]


def test_a_grantor_that_pays_after_camp_aid_is_full_coverage() -> None:
    """Paying whatever the camp's award leaves IS covering the full cost (D143 marks a last-dollar funder full-coverage)."""
    with pytest.raises(ValidationError, match="full-coverage"):
        _save(pays_after_camp_aid=True)
    assert _save(full_coverage=True, pays_after_camp_aid=True).pays_after_camp_aid is True
    assert _save().pays_after_camp_aid is False


def test_a_grantor_key_is_a_lower_snake_slug() -> None:
    with pytest.raises(ValidationError):
        _create(key="Regional Fund")
    with pytest.raises(ValidationError):
        _create(key="1st_fund")


def test_grants_response_requires_grants() -> None:
    """Ruling 1: `grants` is required like any other field, now that the name no longer shadows
    ABCMeta.register (no Field(...) workaround needed)."""
    with pytest.raises(ValidationError):
        GrantsResponse(year=2031, needs_camper=[], unmapped=[], waiting=[], expected=[])  # type: ignore[call-arg]


# --- the register read ---------------------------------------------------------------


def _posting(txn: int, amount: float, **kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "transaction_cm_id": txn,
        "household_cm_id": 100,
        "person_cm_id": 0,
        "amount": -amount,  # CampMinder's sign
        "effective_source_key": "regional grant - north",
        "source_key": "regional grant - north",
        "source_family": "other_outside",
        "funder_type": "outside",
        "post_date": "2031-02-10 17:00:00.000Z",
        "is_reversed": False,
        "reversal_date": "",
        "attribution_method": "household_single_camper",
        "attributed_person_cm_id": 1001,
        "attributed_session_cm_id": 1000101,
        "program_family": "summer",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _person(cm: int, first: str, household: int = 100, primary_childhood_household: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        cm_id=cm,
        first_name=first,
        preferred_name="",
        last_name="Johnson",
        household_id=household,
        primary_childhood_household=primary_childhood_household,
    )


def _attendee(person: int, session: int, status: int = 2, session_type: str = "main") -> SimpleNamespace:
    session_rec = SimpleNamespace(cm_id=session, session_type=session_type, name=f"Session {session % 100}")
    return SimpleNamespace(person_id=person, status_id=status, expand={"session": session_rec})


def _read_repo(**kw: Any) -> MagicMock:
    repo = _repo(
        grantors=[_grantor()],
        sources=[_source("regional grant - north", "regional_fund", description="Regional Grant - North")],
    )
    repo.fetch_grant_postings = AsyncMock(return_value=kw.get("postings", [_posting(9001, 500)]))
    repo.fetch_commitments = AsyncMock(return_value=kw.get("commitments", []))
    repo.fetch_overrides = AsyncMock(return_value=kw.get("overrides", []))
    repo.fetch_links = AsyncMock(return_value=[])
    repo.fetch_household_members = AsyncMock(return_value=[_person(1001, "Emma"), _person(1002, "Liam")])
    repo.fetch_household_persons_by_household = AsyncMock(
        side_effect=_persons_by_household(kw.get("persons", [_person(1001, "Emma"), _person(1002, "Liam")]))
    )
    repo.fetch_persons = AsyncMock(return_value=[])
    repo.fetch_households = AsyncMock(
        return_value=[SimpleNamespace(cm_id=100, mailing_title="The Johnson Family", greeting="")]
    )
    repo.fetch_enrollments = AsyncMock(return_value=[_attendee(1001, 1000101), _attendee(1002, 1000101)])
    repo.fetch_request_refs = AsyncMock(
        return_value=[
            SimpleNamespace(
                id="req-emma-1", household_cm_id=100, person_cm_id=1001, session_cm_id=1000101, status="active"
            )
        ]
    )
    repo.fetch_grant_answers = AsyncMock(return_value=kw.get("answers", []))
    return repo


@pytest.mark.asyncio
async def test_read_builds_the_register_with_names_and_the_suggestion() -> None:
    service, _ = _service(_read_repo())
    out = await service.read(2031)
    (row,) = out.grants
    assert (row.transaction_cm_id, row.amount, row.family_name, row.grantor_name) == (
        9001,
        500.0,
        "The Johnson Family",
        "Regional Fund",
    )
    assert (row.person_cm_id, row.camper_basis, row.counts, row.description) == (
        0,
        "none",
        False,
        "Regional Grant - North",
    )
    (need,) = out.needs_camper
    assert need.suggestion is not None
    assert need.suggestion.camper_name == "Emma Johnson"
    assert [c.name for c in need.candidates] == ["Emma Johnson", "Liam Johnson"]  # sorted by name
    assert need.household_applied is True


@pytest.mark.asyncio
async def test_read_with_rows_loads_once_for_the_read_and_the_register() -> None:
    """Slice 1: Today and the household page price the season and show the register from ONE load."""
    repo = _read_repo()
    service, _ = _service(repo)
    out, rows = await service.read_with_rows(2031)
    assert out == await service.read(2031)
    assert [r.transaction_cm_id for r in rows] == [g.transaction_cm_id for g in out.grants]
    assert repo.fetch_grant_postings.await_count == 2  # once per call above, never twice in one


@pytest.mark.asyncio
async def test_one_grants_load_serves_the_register_and_the_read_from_a_single_load() -> None:
    repo = _read_repo()
    service, _ = _service(repo)
    shared = OneGrantsLoad(service, 2031)
    rows, (out, _) = await asyncio.gather(shared.register(2031), shared.read())
    assert [r.transaction_cm_id for r in rows] == [g.transaction_cm_id for g in out.grants]
    assert repo.fetch_grant_postings.await_count == 1
    with pytest.raises(ValueError, match="2032"):
        await shared.register(2032)


# Ruling D (owner 10-06): the Register names each row's family by the household card's label, from the household
# page's own helper, with a tie-break only where two households in the same read read the same.
BECKERS = "Liam & Olivia Becker"


def _labelled(repo: MagicMock, labels: FakeLabels) -> GrantsService:
    patch(f"{SERVICE}.current_season_year", AsyncMock(return_value=2031)).start()
    return GrantsService(repo, labels=labels)


@pytest.mark.asyncio
async def test_each_register_row_names_its_family_by_the_household_pages_label() -> None:
    repo = _read_repo(postings=[_posting(9001, 500), _posting(9002, 300, household_cm_id=150)])
    labels = FakeLabels({100: BECKERS, 150: BECKERS})
    out = await _labelled(repo, labels).read(2031)
    assert {g.transaction_cm_id: (g.label, g.label_tiebreak) for g in out.grants} == {
        9001: (BECKERS, "#100"),
        9002: (BECKERS, "#150"),
    }
    # The copies needs a camper shows read the same.
    assert {n.grant.transaction_cm_id: (n.grant.label, n.grant.label_tiebreak) for n in out.needs_camper} == {
        9001: (BECKERS, "#100"),
    }
    assert {g.transaction_cm_id: g.family_name for g in out.grants}[9001] == "The Johnson Family"  # as it was
    assert labels.calls == [frozenset({100, 150})]  # one call: the read's households


@pytest.mark.asyncio
async def test_a_register_with_one_household_per_label_has_no_tiebreak() -> None:
    out = await _labelled(_read_repo(), FakeLabels({100: BECKERS})).read(2031)
    assert [(g.label, g.label_tiebreak) for g in out.grants] == [(BECKERS, "")]


@pytest.mark.asyncio
async def test_a_grants_read_without_the_label_helper_names_no_label() -> None:
    """Today and the household page read the register for its figures and name households their own way: they pay
    for no label read, and every row's label stays empty."""
    service, _ = _service(_read_repo())
    out = await service.read(2031)
    assert [(g.label, g.label_tiebreak) for g in out.grants] == [("", "")]


def test_a_register_rows_label_defaults_to_empty() -> None:
    assert GrantRowOut.model_fields["label"].default == ""
    assert GrantRowOut.model_fields["label_tiebreak"].default == ""


def _never_applied_repo(**kw: Any) -> MagicMock:
    """Household 100 with no aid request, one enrolled camper (Emma) and an unenrolled sibling."""
    repo = _read_repo(**kw)
    repo.fetch_request_refs = AsyncMock(return_value=[])
    repo.fetch_enrollments = AsyncMock(return_value=[_attendee(1001, 1000101)])
    return repo


@pytest.mark.asyncio
async def test_read_ties_a_never_applied_households_grant_to_its_sole_camper() -> None:
    """D126 + D142: the household never applied, and Emma is the one camper the grant can pay for,
    so the grant names her by machine and nothing waits for the registrar."""
    service, _ = _service(_never_applied_repo())
    out = await service.read(2031)
    (row,) = out.grants
    assert (row.person_cm_id, row.camper_name, row.camper_basis, row.counts) == (
        1001,
        "Emma Johnson",
        "sole_camper",
        True,
    )
    assert out.needs_camper == []


@pytest.mark.asyncio
async def test_a_camper_linked_by_a_childhood_household_is_a_second_candidate() -> None:
    """D142 ties only when the household has exactly one camper, counted by the membership rule
    Go's attribution and place() use (own OR childhood household): Olivia's own household is 150
    but her childhood household is 100, so the grant has two campers and stays at household level."""
    olivia = _person(1060, "Olivia", household=150, primary_childhood_household=100)
    repo = _never_applied_repo(persons=[_person(1001, "Emma"), _person(1002, "Liam"), olivia])
    repo.fetch_enrollments = AsyncMock(return_value=[_attendee(1001, 1000101), _attendee(1060, 1000101)])
    service, _ = _service(repo)
    (row,) = (await service.read(2031)).grants
    assert (row.person_cm_id, row.camper_basis) == (0, "none")


@pytest.mark.asyncio
async def test_read_asks_for_the_wider_family_pool_only_where_a_grant_can_tie() -> None:
    """The own-or-childhood pool is one query per few households; the register read needs it only
    for a family that never applied (D142), so an applicant-only season never pays for it."""
    repo = _read_repo()
    service, _ = _service(repo)
    out = await service.read(2031)
    assert repo.fetch_household_persons_by_household.await_count == 0
    assert [c.name for c in out.needs_camper[0].candidates] == ["Emma Johnson", "Liam Johnson"]


@pytest.mark.asyncio
async def test_a_grant_whose_linked_household_applied_still_needs_a_camper() -> None:
    """D126 is about families: household 150's own request list is empty, but it is linked to
    household 100, which applied, so its grant waits for the registrar rather than tying itself."""
    repo = _never_applied_repo(persons=[_person(1001, "Emma", household=150)])
    repo.fetch_grant_postings = AsyncMock(return_value=[_posting(9001, 500, household_cm_id=150)])
    repo.fetch_links = AsyncMock(
        return_value=[SimpleNamespace(household_cm_id=h, family_key="family-1", excluded=False) for h in (100, 150)]
    )
    repo.fetch_request_refs = AsyncMock(
        return_value=[
            SimpleNamespace(id="req-1", household_cm_id=100, person_cm_id=1002, session_cm_id=1000101, status="active")
        ]
    )
    service, _ = _service(repo)
    out = await service.read(2031)
    (row,) = out.grants
    assert (row.person_cm_id, row.camper_basis) == (0, "none")
    assert [n.grant.transaction_cm_id for n in out.needs_camper] == [9001]


@pytest.mark.asyncio
async def test_read_reads_the_sources_reporting_group_before_tying() -> None:
    """D100: a Quest-only source can't pay for a summer camper, so the grant stays at household
    level -- and, the household never having applied, off "needs a camper" (D126)."""
    repo = _never_applied_repo()
    repo.fetch_sources = AsyncMock(
        return_value=[_source("regional grant - north", "regional_fund", implied_program_families=["quest"])]
    )
    service, _ = _service(repo)
    out = await service.read(2031)
    (row,) = out.grants
    assert (row.person_cm_id, row.camper_basis, row.counts) == (0, "none", False)
    assert out.needs_camper == []


@pytest.mark.asyncio
async def test_register_rows_are_the_rows_the_read_reports() -> None:
    """Sub-project 10a prices from these rows (the calculator's grants bridge), so they must be the
    register the Grants screen shows, built the same way."""
    service, _ = _service(_read_repo())
    rows = await service.register_rows(2031)
    shown = (await service.read(2031)).grants
    assert [(r.transaction_cm_id, float(r.amount), r.counts) for r in rows] == [
        (g.transaction_cm_id, g.amount, g.counts) for g in shown
    ]


@pytest.mark.asyncio
async def test_register_rows_mark_a_pays_after_camp_aid_grantors_grants() -> None:
    """D143: the register carries the grantor fact on each row, so the calculator bridge can leave
    the grant out while the register keeps it."""
    repo = _read_repo(postings=[_posting(9001, 500, person_cm_id=1001)])
    repo.fetch_grantors = AsyncMock(return_value=[_grantor(full_coverage=True, pays_after_camp_aid=True)])
    service, _ = _service(repo)
    (row,) = await service.register_rows(2031)
    assert (row.grantor_key, row.pays_after_camp_aid, row.counts) == ("regional_fund", True, True)
    (plain,) = await _service(_read_repo(postings=[_posting(9001, 500, person_cm_id=1001)]))[0].register_rows(2031)
    assert plain.pays_after_camp_aid is False


@pytest.mark.asyncio
async def test_needs_camper_candidates_include_an_attributed_person_from_another_household() -> None:
    """Ruling 2b: the suggestion's person is always a candidate when they're enrolled this season,
    even when their own household isn't the line's (Go's attribution can name someone
    fetch_household_members' own-household-only pool wouldn't have returned)."""
    repo = _read_repo(postings=[_posting(9001, 500, attributed_person_cm_id=1099, attributed_session_cm_id=1000101)])
    repo.fetch_persons = AsyncMock(return_value=[_person(1099, "Jordan", household=150)])
    repo.fetch_enrollments = AsyncMock(
        return_value=[_attendee(1001, 1000101), _attendee(1002, 1000101), _attendee(1099, 1000101)]
    )
    service, _ = _service(repo)
    out = await service.read(2031)
    (need,) = out.needs_camper
    assert need.suggestion is not None
    assert need.suggestion.person_cm_id == 1099
    assert [c.name for c in need.candidates] == ["Emma Johnson", "Jordan Johnson", "Liam Johnson"]


@pytest.mark.asyncio
async def test_read_overlays_a_placement_at_once() -> None:
    placed = SimpleNamespace(
        transaction_cm_id=9001,
        attributed_person_cm_id=1001,
        attributed_session_cm_id=1000101,
        program_family="summer",
        source_key_override="",
        source="staff",
    )
    service, _ = _service(_read_repo(overrides=[placed]))
    out = await service.read(2031)
    (row,) = out.grants
    assert (row.person_cm_id, row.camper_basis, row.camper_name, row.session_name) == (
        1001,
        "placed",
        "Emma Johnson",
        "Session 1",
    )
    assert [(s.request_id, s.amount) for s in row.requests] == [("req-emma-1", 500.0)]
    assert out.needs_camper == []


@pytest.mark.asyncio
async def test_a_reclassify_only_override_is_not_a_placement() -> None:
    reclassified = SimpleNamespace(
        transaction_cm_id=9001,
        attributed_person_cm_id=0,
        attributed_session_cm_id=0,
        program_family="",
        source_key_override="outside program award",
        source="staff",
    )
    service, _ = _service(_read_repo(overrides=[reclassified]))
    assert len((await service.read(2031)).needs_camper) == 1


@pytest.mark.asyncio
async def test_read_lists_expected_from_yes_answers() -> None:
    answer = SimpleNamespace(
        person_id=1002, one_happy_camper="Yes", synagogue_grant="No", expand={"household": SimpleNamespace(cm_id=100)}
    )
    service, _ = _service(_read_repo(answers=[answer]))
    (expected,) = (await service.read(2031)).expected
    assert (expected.kind, expected.person_cm_ids, expected.camper_names) == (
        "one_happy_camper",
        [1002],
        ["Liam Johnson"],
    )


@pytest.mark.asyncio
async def test_an_expected_grant_carries_its_one_active_grantors_name() -> None:
    answer = SimpleNamespace(
        person_id=1002, one_happy_camper="Yes", synagogue_grant="No", expand={"household": SimpleNamespace(cm_id=100)}
    )
    repo = _read_repo(answers=[answer])
    repo.fetch_sources = AsyncMock(
        return_value=[_source("camper fund", "regional_fund", source_family="one_happy_camper")]
    )
    (expected,) = (await _service(repo)[0].read(2031)).expected
    assert expected.display_name == "Regional Fund"
    retired = _grantor(retired_at="2031-01-01 00:00:00.000Z")
    repo.fetch_grantors = AsyncMock(return_value=[retired])
    (expected,) = (await _service(repo)[0].read(2031)).expected
    assert expected.display_name is None


@pytest.mark.asyncio
async def test_a_commitment_waits_with_its_days() -> None:
    commitment = SimpleNamespace(
        id="com000000000001",
        year=2031,
        grantor_key="regional_fund",
        household_cm_id=100,
        person_cm_id=1002,
        session_cm_id=0,
        program_family="",
        amount=250.0,
        committed_on="2031-01-20 00:00:00.000Z",
        created="2031-01-21 18:00:00.000Z",
        status="open",
        withdrawn_at="",
        note="",
    )
    service, _ = _service(_read_repo(commitments=[commitment]))
    service._clock = lambda: datetime(2031, 3, 1, 20, 0, tzinfo=UTC)
    out = await service.read(2031)
    (waiting,) = out.waiting
    assert (waiting.grant.commitment_id, waiting.days_waiting, waiting.grant.camper_name) == (
        "com000000000001",
        40,
        "Liam Johnson",
    )
    assert (waiting.reason, waiting.transaction_cm_id) == ("possible_match", 9001)  # the line on Emma


@pytest.mark.asyncio
async def test_a_commitment_row_carries_its_committed_date_and_stored_note() -> None:
    """Slice 3 ask 9: the edit form opens on what is stored, since PUT replaces the whole record. A ledger line is
    not a commitment, so it carries neither, and the waiting group's copy of the row carries both."""
    commitment = SimpleNamespace(
        id="com000000000001",
        year=2031,
        grantor_key="regional_fund",
        household_cm_id=100,
        person_cm_id=1002,
        session_cm_id=0,
        program_family="",
        amount=250.0,
        committed_on="2031-01-20 00:00:00.000Z",
        created="2031-01-21 18:00:00.000Z",
        status="open",
        withdrawn_at="",
        note="Pledged by letter; posts in June",
    )
    service, _ = _service(_read_repo(commitments=[commitment]))
    service._clock = lambda: datetime(2031, 3, 1, 20, 0, tzinfo=UTC)
    out = await service.read(2031)
    rows = {row.kind: row for row in out.grants}
    assert (rows["commitment"].committed_on, rows["commitment"].commitment_note) == (
        "2031-01-20",
        "Pledged by letter; posts in June",
    )
    assert rows["commitment"].committed_on == rows["commitment"].recorded_on
    assert (rows["ledger"].committed_on, rows["ledger"].commitment_note) == ("", "")
    (waiting,) = out.waiting
    assert (waiting.grant.committed_on, waiting.grant.commitment_note) == (
        "2031-01-20",
        "Pledged by letter; posts in June",
    )


# --- placements -----------------------------------------------------------------------


def _persons_by_household(persons: list[SimpleNamespace]) -> Any:
    """Ruling 2a: a stand-in for the real fetch_household_persons_by_household, which scopes each
    household to the people Go's attribution treats as its own -- own household OR a childhood
    household -- unlike a static AsyncMock. This is what lets both the "not in the family"
    refusal (Riley) and the childhood-household acceptance (Olivia) mean something: a plain
    household_id comparison would get Riley right but Olivia wrong."""

    async def _by_household(_year: int, household_ids: Collection[int]) -> dict[int, list[Any]]:
        return {
            h: [p for p in persons if h in (p.household_id, getattr(p, "primary_childhood_household", 0))]
            for h in set(household_ids)
        }

    return _by_household


def _place_repo(**kw: Any) -> MagicMock:
    repo = _repo()
    repo.fetch_grant_postings = AsyncMock(return_value=kw.get("postings", [_posting(9001, 500), _posting(9002, 300)]))
    repo.fetch_overrides = AsyncMock(return_value=kw.get("overrides", []))
    repo.fetch_links = AsyncMock(return_value=[])
    persons = [
        _person(1001, "Emma"),
        _person(1002, "Liam"),
        _person(1050, "Riley", household=150),
        # Olivia's OWN household is 150 (unrelated to the line's 100), but their PRIMARY
        # CHILDHOOD household is 100 — Ruling 2a: fetch_household_persons' real pool is own OR
        # childhood household, so Olivia belongs to family {100} even though Riley (also household
        # 150, no childhood link) does not.
        _person(1060, "Olivia", household=150, primary_childhood_household=100),
    ]

    repo.fetch_household_persons_by_household = AsyncMock(side_effect=_persons_by_household(persons))
    repo.fetch_enrollments = AsyncMock(
        return_value=[
            _attendee(1001, 1000101),
            _attendee(1001, 1000102),
            _attendee(1002, 1000101),
            _attendee(1060, 1000101),
        ]
    )
    return repo


def _placements(*rows: dict[str, Any], note: str = "") -> PlaceGrantsIn:
    return PlaceGrantsIn(placements=list(rows), note=note)


@pytest.mark.asyncio
async def test_placing_a_class_is_one_operation_of_staff_overrides() -> None:
    service, spy = _service(_place_repo())
    out = await service.place(
        2031,
        _placements(
            {"transaction_cm_id": 9001, "person_cm_id": 1001, "session_cm_id": 1000101},
            {"transaction_cm_id": 9002, "person_cm_id": 1002},
        ),
        ACTOR,
    )
    assert (out.placed, out.unchanged) == (2, 0)
    assert out.operation_id
    first, second = spy.writes
    assert first.collection == "aid_attribution_overrides"
    assert first.log_action == "place_grant"
    assert first.data is not None
    assert first.data["attributed_session_cm_id"] == 1000101
    assert first.data["program_family"] == "summer"
    assert first.data["source"] == "staff"
    assert second.data is not None
    assert second.data["attributed_session_cm_id"] == 0
    assert second.data["program_family"] == "summer"  # every one of Liam's enrollments is summer
    assert spy.kwargs["actor"] == ACTOR


@pytest.mark.asyncio
async def test_placing_a_class_across_households_looks_up_family_members_once() -> None:
    """SP6-core T7: one repository call for the whole batch, however many households it spans,
    instead of one query per household (~65 ms each; a 100-household class took ~7 s)."""
    repo = _place_repo(postings=[_posting(9001, 500), _posting(9003, 200, household_cm_id=150)])
    service, spy = _service(repo)
    out = await service.place(
        2031,
        _placements(
            {"transaction_cm_id": 9001, "person_cm_id": 1001}, {"transaction_cm_id": 9003, "person_cm_id": 1050}
        ),
        ACTOR,
    )
    assert out.placed == 2
    assert repo.fetch_household_persons_by_household.await_count == 1


@pytest.mark.asyncio
async def test_placing_keeps_an_existing_reclassification() -> None:
    existing = SimpleNamespace(
        id="ovr000000000001",
        year=2031,
        transaction_cm_id=9001,
        attributed_person_cm_id=0,
        attributed_session_cm_id=0,
        program_family="",
        source_key_override="outside program award",
        source="staff",
        note="Reclassified",
    )
    service, spy = _service(_place_repo(overrides=[existing]))
    await service.place(2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}), ACTOR)
    (write,) = spy.writes
    assert write.action == "update"
    assert write.record_id == "ovr000000000001"
    assert write.data is not None
    assert write.data["source_key_override"] == "outside program award"
    assert write.data["note"] == "Reclassified"  # ruling: an empty placement note keeps it

    await service.place(
        2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}, note="Confirmed by phone"), ACTOR
    )
    (write2,) = spy.writes
    assert write2.data is not None
    assert write2.data["note"] == "Confirmed by phone"  # a non-empty placement note still replaces it


@pytest.mark.asyncio
async def test_re_confirming_the_same_camper_writes_nothing() -> None:
    """Review Focus 4."""
    existing = SimpleNamespace(
        id="ovr000000000001",
        year=2031,
        transaction_cm_id=9001,
        attributed_person_cm_id=1001,
        attributed_session_cm_id=1000101,
        program_family="summer",
        source_key_override="",
        source="staff",
        note="",
    )
    service, spy = _service(_place_repo(overrides=[existing]))
    out = await service.place(
        2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001, "session_cm_id": 1000101}), ACTOR
    )
    assert (out.placed, out.unchanged, out.operation_id) == (0, 1, None)
    assert not spy.called


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("row", "message"),
    [
        ({"transaction_cm_id": 9999, "person_cm_id": 1001}, "not a live grant line"),
        ({"transaction_cm_id": 9001, "person_cm_id": 1050}, "not in the family"),
        ({"transaction_cm_id": 9001, "person_cm_id": 1001, "session_cm_id": 1000199}, "no enrollment"),
    ],
)
async def test_one_bad_placement_refuses_the_whole_batch(row: dict[str, Any], message: str) -> None:
    """Review Focus 3 / Decision 11: all or nothing, and the refusal names the transaction."""
    service, spy = _service(_place_repo())
    good = {"transaction_cm_id": 9002, "person_cm_id": 1002}
    with pytest.raises(FinancialAidValidationError, match=message):
        await service.place(2031, _placements(good, row), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_place_accepts_a_person_linked_only_via_a_childhood_household() -> None:
    """Ruling 2a: fetch_household_persons' real pool is own household OR a childhood household,
    not just fetch_household_members' own-household-only pool. Pins this against a regression
    that reverts place() to a plain household_id comparison: Olivia's own household is 150 (not
    the line's 100), but their primary childhood household is 100."""
    service, spy = _service(_place_repo())
    out = await service.place(
        2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1060, "session_cm_id": 1000101}), ACTOR
    )
    assert out.placed == 1
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["attributed_person_cm_id"] == 1060


@pytest.mark.asyncio
async def test_person_only_placement_infers_family_from_active_enrollments_only() -> None:
    """Controller ruling (round 1, item 2): matches Go's fromOverride, which considers only
    ACTIVE enrollments when a placement doesn't name a session — a cancelled enrollment in a
    different program family must not turn a single clear family into an ambiguous ""."""
    repo = _place_repo()
    repo.fetch_enrollments = AsyncMock(
        return_value=[
            _attendee(1001, 1000101, status=2),  # active, summer
            _attendee(1001, 1000199, status=3, session_type="quest"),  # cancelled, quest
        ]
    )
    service, spy = _service(repo)
    await service.place(2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}), ACTOR)
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["program_family"] == "summer"


@pytest.mark.asyncio
async def test_a_person_only_placement_keeps_the_lines_program_when_the_camper_is_in_two() -> None:
    """Owner ruling 2026-09-29 (report D4): a camper active in Summer and Quest gives no single
    family, and "" would spread a Quest grant onto the Summer request too. The line's own program
    wins when the camper is enrolled in it."""
    repo = _place_repo(postings=[_posting(9001, 900, program_family="quest")])
    repo.fetch_enrollments = AsyncMock(
        return_value=[_attendee(1001, 1000101), _attendee(1001, 1000201, session_type="quest")]
    )
    service, spy = _service(repo)
    await service.place(2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}), ACTOR)
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["program_family"] == "quest"


@pytest.mark.asyncio
async def test_a_person_only_placement_stays_ambiguous_when_the_line_names_no_program_of_the_camper() -> None:
    repo = _place_repo(postings=[_posting(9001, 900, program_family="teen")])
    repo.fetch_enrollments = AsyncMock(
        return_value=[_attendee(1001, 1000101), _attendee(1001, 1000201, session_type="quest")]
    )
    service, spy = _service(repo)
    await service.place(2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}), ACTOR)
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["program_family"] == ""


@pytest.mark.asyncio
async def test_an_explicit_session_accepts_a_cancelled_enrollment() -> None:
    """Controller ruling (round 1, item 2): an explicit session_cm_id accepts an enrollment of
    any status — a grant may belong to a session the camper later cancelled — and takes that
    session's family."""
    repo = _place_repo()
    repo.fetch_enrollments = AsyncMock(
        return_value=[_attendee(1001, 1000199, status=3, session_type="quest")]  # cancelled
    )
    service, spy = _service(repo)
    out = await service.place(
        2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001, "session_cm_id": 1000199}), ACTOR
    )
    assert out.placed == 1
    (write,) = spy.writes
    assert write.data is not None
    assert write.data["attributed_session_cm_id"] == 1000199
    assert write.data["program_family"] == "quest"


@pytest.mark.asyncio
async def test_a_reversed_line_cannot_be_placed() -> None:
    reversed_line = _posting(9001, 500, is_reversed=True, reversal_date="2031-03-01 17:00:00.000Z")
    service, spy = _service(_place_repo(postings=[reversed_line]))
    with pytest.raises(FinancialAidValidationError, match="not a live grant line"):
        await service.place(2031, _placements({"transaction_cm_id": 9001, "person_cm_id": 1001}), ACTOR)
    assert not spy.called


def test_a_placement_batch_names_each_transaction_once() -> None:
    with pytest.raises(ValidationError):
        _placements(
            {"transaction_cm_id": 9001, "person_cm_id": 1001}, {"transaction_cm_id": 9001, "person_cm_id": 1002}
        )


# --- commitments ------------------------------------------------------------------------


def _commit_repo(**kw: Any) -> MagicMock:
    repo = _repo(grantor=kw.get("grantor", _grantor()))
    repo.fetch_links = AsyncMock(return_value=[])
    persons = [_person(1001, "Emma"), _person(1050, "Riley", household=150)]

    repo.fetch_household_persons_by_household = AsyncMock(side_effect=_persons_by_household(persons))
    repo.fetch_enrollments = AsyncMock(return_value=[_attendee(1001, 1000101)])
    repo.get_commitment = AsyncMock(return_value=kw.get("commitment"))
    return repo


def _commitment_in(**kw: Any) -> CommitmentIn:
    base: dict[str, Any] = {
        "grantor_key": "regional_fund",
        "household_cm_id": 100,
        "person_cm_id": 1001,
        "amount": "750.00",
        "committed_on": date(2031, 1, 20),
    }
    base.update(kw)
    return CommitmentIn(**base)


def _stored(**kw: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "com000000000001",
        "year": 2031,
        "grantor_key": "regional_fund",
        "household_cm_id": 100,
        "person_cm_id": 1001,
        "session_cm_id": 0,
        "program_family": "summer",
        "amount": 750.0,
        "committed_on": "2031-01-20 00:00:00.000Z",
        "status": "open",
        "withdrawn_at": "",
        "note": "",
    }
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_creating_a_commitment_writes_it_open_with_its_log_row() -> None:
    service, spy = _service(_commit_repo())
    out = await service.create_commitment(2031, _commitment_in(), ACTOR)
    assert (out.status, out.amount, out.program_family, out.committed_on) == ("open", 750.0, "summer", "2031-01-20")
    (write,) = spy.writes
    assert write.collection == "aid_grants"
    assert write.action == "create"
    assert write.data is not None
    assert write.data["status"] == "open"
    assert write.data["actor"] == ACTOR
    assert out.id == write.record_id  # the id the service generated and wrote


@pytest.mark.asyncio
async def test_a_commitment_needs_a_known_grantor() -> None:
    service, spy = _service(_commit_repo(grantor=None))
    with pytest.raises(FinancialAidNotFoundError, match="grantor"):
        await service.create_commitment(2031, _commitment_in(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_a_commitment_cannot_name_a_retired_grantor() -> None:
    """A retired grantor is hidden from pickers; a grant naming one would also undo what retiring it checked."""
    retired = _grantor(retired_at="2031-02-01 18:30:00.000Z")
    service, spy = _service(_commit_repo(grantor=retired, commitment=_stored()))
    with pytest.raises(FinancialAidValidationError, match=r"^Regional Fund is retired; unretire it first$"):
        await service.create_commitment(2031, _commitment_in(), ACTOR)
    with pytest.raises(FinancialAidValidationError, match="retired"):
        await service.save_commitment(2031, "com000000000001", _commitment_in(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_a_commitments_camper_must_be_in_the_household() -> None:
    service, spy = _service(_commit_repo())
    with pytest.raises(FinancialAidValidationError, match="not in household"):
        await service.create_commitment(2031, _commitment_in(person_cm_id=1050), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_a_commitment_cannot_name_an_incentive_grantor() -> None:
    repo = _commit_repo()
    repo.fetch_sources = AsyncMock(
        return_value=[
            _source("family incentive grant", "regional_fund", funder_type="incentive", source_family="jfam_incentive")
        ]
    )
    service, spy = _service(repo)
    with pytest.raises(FinancialAidValidationError, match="incentive"):
        await service.create_commitment(2031, _commitment_in(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_a_commitment_infers_program_family_from_active_enrollments_only() -> None:
    """Ruling 2: with no session, only ACTIVE enrollments (ACTIVE_ENROLLED_STATUS_ID) count toward
    the family -- a cancelled enrollment in a different program family must not turn a single
    clear family into an ambiguous ""."""
    repo = _commit_repo()
    repo.fetch_enrollments = AsyncMock(
        return_value=[
            _attendee(1001, 1000101, status=2),  # active, summer
            _attendee(1001, 1000199, status=3, session_type="quest"),  # cancelled, quest
        ]
    )
    service, _ = _service(repo)
    out = await service.create_commitment(2031, _commitment_in(), ACTOR)
    assert out.program_family == "summer"


@pytest.mark.asyncio
async def test_saving_an_unchanged_commitment_writes_nothing() -> None:
    service, spy = _service(_commit_repo(commitment=_stored()))
    await service.save_commitment(2031, "com000000000001", _commitment_in(), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_saving_a_changed_amount_logs_the_amount() -> None:
    service, spy = _service(_commit_repo(commitment=_stored()))
    out = await service.save_commitment(2031, "com000000000001", _commitment_in(amount="800"), ACTOR)
    assert out.amount == 800.0
    (log,) = spy.log_rows()
    assert log["before"] == {"amount": 750.0}
    assert log["after"] == {"amount": 800.0}


@pytest.mark.asyncio
async def test_a_withdrawn_commitment_cannot_be_edited_or_withdrawn_again() -> None:
    service, spy = _service(_commit_repo(commitment=_stored(status="withdrawn")))
    with pytest.raises(FinancialAidValidationError, match="withdrawn"):
        await service.save_commitment(2031, "com000000000001", _commitment_in(amount="800"), ACTOR)
    with pytest.raises(FinancialAidValidationError, match="already withdrawn"):
        await service.withdraw_commitment(2031, "com000000000001", WithdrawIn(reason="Duplicate"), ACTOR)
    assert not spy.called


@pytest.mark.asyncio
async def test_withdrawing_records_when_and_why() -> None:
    service, spy = _service(_commit_repo(commitment=_stored()))
    service._clock = lambda: datetime(2031, 2, 1, 18, 0, tzinfo=UTC)
    out = await service.withdraw_commitment(2031, "com000000000001", WithdrawIn(reason="The grantor declined"), ACTOR)
    assert out.status == "withdrawn"
    assert out.withdrawn_at.startswith("2031-02-01")
    (write,) = spy.writes
    assert write.log_action == "withdraw"
    assert write.data == {"status": "withdrawn", "withdrawn_at": "2031-02-01 18:00:00.000Z", "actor": ACTOR}
    assert spy.kwargs["reason"] == "The grantor declined"
    assert spy.kwargs["require_reason"] is True


@pytest.mark.asyncio
async def test_a_commitment_from_another_season_is_not_found() -> None:
    service, _ = _service(_commit_repo(commitment=_stored(year=2030)))
    with pytest.raises(FinancialAidNotFoundError):
        await service.withdraw_commitment(2031, "com000000000001", WithdrawIn(reason="x"), ACTOR)


def test_a_commitment_amount_is_positive_whole_cents() -> None:
    with pytest.raises(ValidationError):
        _commitment_in(amount="0")
    with pytest.raises(ValidationError):
        _commitment_in(amount="10.005")


# --- a write that lost a race (slice 3 back-end PR-B) ----------------------------------------------------


def _refuse(status: int, field_errors: dict[str, str] | None = None) -> None:
    """PocketBase refuses the operation's first sub-request: the batch rolled back, and nothing was written."""

    def refused(pb: Any, requests: list[BatchRequest], *, max_requests: int) -> list[BatchResult]:
        raise BatchRequestFailedError(
            index=0,
            total=len(requests),
            request=requests[0],
            status=status,
            message="refused",
            field_errors=field_errors or {},
            response=None,
        )

    patch("bunking.financial_aid.change_log.send_batch", side_effect=refused).start()


@pytest.mark.asyncio
async def test_a_grantor_key_someone_created_first_is_a_conflict_not_a_500() -> None:
    """Two people adding one grantor: the second create hits the unique key. G6's refusal, so the route says 409."""
    service, _ = _service(_repo())
    _refuse(400, {"key": "Value must be unique."})
    with pytest.raises(AidWriteConflictError) as refused:
        await service.create_grantor(_create(), ACTOR)
    assert (refused.value.collection, str(refused.value)) == ("aid_grantors", CONFLICT_MESSAGE)


@pytest.mark.asyncio
async def test_a_grantor_someone_removed_first_is_a_conflict_not_a_500() -> None:
    service, _ = _service(_repo(grantor=_grantor()))
    _refuse(404)
    with pytest.raises(AidWriteConflictError) as refused:
        await service.save_grantor("regional_fund", _save(name="Regional Fund North"), ACTOR)
    assert (refused.value.collection, refused.value.record_id) == ("aid_grantors", "gra000000000001")


@pytest.mark.asyncio
async def test_a_grants_refusal_that_is_no_race_is_not_dressed_as_one() -> None:
    service, _ = _service(_repo())
    _refuse(400, {"name": "Cannot be blank."})
    with pytest.raises(BatchRequestFailedError):
        await service.create_grantor(_create(), ACTOR)


# The Register names a row's program by the season's rules label (programs.<key>.label), never the key: the same
# loader the summary and the Ledger use. "" for a key the rules don't name, a row with no program, or no loader.
def _with_program_labels(repo: MagicMock, labels: dict[str, str]) -> tuple[GrantsService, AsyncMock]:
    patch(f"{SERVICE}.current_season_year", AsyncMock(return_value=2031)).start()
    loader = AsyncMock(return_value=labels)
    return GrantsService(repo, program_labels=loader), loader


@pytest.mark.asyncio
async def test_each_register_row_carries_its_programs_rules_label() -> None:
    placed = _posting(9002, 300, person_cm_id=1001)
    other = _posting(9003, 200, person_cm_id=1002, attributed_person_cm_id=1002, attributed_session_cm_id=1000201)
    repo = _read_repo(postings=[_posting(9001, 500), placed, other])
    repo.fetch_enrollments = AsyncMock(
        return_value=[_attendee(1001, 1000101), _attendee(1002, 1000201, session_type="quest")]
    )
    service, loader = _with_program_labels(repo, {"summer": "Summer Camp", "quest": "Quest Week"})
    out = await service.read(2031)
    assert {g.transaction_cm_id: (g.program_family, g.program_label) for g in out.grants} == {
        9001: ("", ""),  # nobody placed yet: no program, no label
        9002: ("summer", "Summer Camp"),
        9003: ("quest", "Quest Week"),
    }
    # The copies needs a camper shows read the same, and so does its suggestion.
    (need,) = out.needs_camper
    assert need.grant.transaction_cm_id == 9001
    assert need.suggestion is not None
    assert (need.suggestion.program_family, need.suggestion.program_label) == ("summer", "Summer Camp")
    loader.assert_awaited_once_with(2031)


@pytest.mark.asyncio
async def test_a_program_the_rules_dont_name_reads_an_empty_label() -> None:
    repo = _read_repo(postings=[_posting(9001, 500, person_cm_id=1001)])
    service, _ = _with_program_labels(repo, {"quest": "Quest Week"})
    (row,) = (await service.read(2031)).grants
    assert (row.program_family, row.program_label) == ("summer", "")


@pytest.mark.asyncio
async def test_a_grants_read_without_the_program_label_loader_names_no_label() -> None:
    """Today and the household page read the register for its figures and pay for no rules read."""
    service, _ = _service(_read_repo())
    out = await service.read(2031)
    assert [g.program_label for g in out.grants] == [""]


def test_a_register_rows_program_label_defaults_to_empty() -> None:
    assert GrantRowOut.model_fields["program_label"].default == ""
    assert CamperSuggestionOut.model_fields["program_label"].default == ""


def test_the_grants_route_reads_labels_from_the_same_approved_rules_as_the_summary() -> None:
    from api.routers import financial_aid as router

    with patch.object(router, "GrantsService") as service:
        router._grants()
    assert service.call_args.kwargs["program_labels"] is router._program_labels
