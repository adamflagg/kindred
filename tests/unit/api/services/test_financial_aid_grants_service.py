"""Grants service (sub-project 6-core): the grantor directory, the register read, placements
and commitments. Fictional data only; every write runs the real 4a helper over a fake batch."""

from __future__ import annotations

from collections.abc import Collection
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid_grants import GrantorCreate, GrantorSave, GrantsResponse, PlaceGrantsIn
from api.services.financial_aid_grants_service import GrantorKeyTakenError, GrantsService
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError, FinancialAidValidationError
from tests.unit.api.services.aid_commit_spy import AidCommitSpy, spy_on_commits

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
        "eligibility": "",
        "contacts": "",
        "note": "",
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


def test_covers_canteen_is_recorded_only_for_a_full_coverage_grantor() -> None:
    with pytest.raises(ValidationError, match="full-coverage"):
        _save(covers_canteen="no")
    assert _save(full_coverage=True, covers_canteen="no").covers_canteen == "no"
    assert _save(covers_canteen="unknown").covers_canteen == "unknown"


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
        last_name="Rivera",
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
    repo.fetch_household_members = AsyncMock(return_value=[_person(1001, "Sam"), _person(1002, "Alex")])
    repo.fetch_persons = AsyncMock(return_value=[])
    repo.fetch_households = AsyncMock(
        return_value=[SimpleNamespace(cm_id=100, mailing_title="The Rivera Family", greeting="")]
    )
    repo.fetch_enrollments = AsyncMock(return_value=[_attendee(1001, 1000101), _attendee(1002, 1000101)])
    repo.fetch_request_refs = AsyncMock(
        return_value=[
            SimpleNamespace(
                id="req-sam-1", household_cm_id=100, person_cm_id=1001, session_cm_id=1000101, status="active"
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
        "The Rivera Family",
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
    assert need.suggestion.camper_name == "Sam Rivera"
    assert [c.name for c in need.candidates] == ["Alex Rivera", "Sam Rivera"]  # sorted by name
    assert need.household_applied is True


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
    assert [c.name for c in need.candidates] == ["Alex Rivera", "Jordan Rivera", "Sam Rivera"]


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
        "Sam Rivera",
        "Session 1",
    )
    assert [(s.request_id, s.amount) for s in row.requests] == [("req-sam-1", 500.0)]
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
        ["Alex Rivera"],
    )


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
        "Alex Rivera",
    )


# --- placements -----------------------------------------------------------------------


def _place_repo(**kw: Any) -> MagicMock:
    repo = _repo()
    repo.fetch_grant_postings = AsyncMock(return_value=kw.get("postings", [_posting(9001, 500), _posting(9002, 300)]))
    repo.fetch_overrides = AsyncMock(return_value=kw.get("overrides", []))
    repo.fetch_links = AsyncMock(return_value=[])
    persons = [
        _person(1001, "Sam"),
        _person(1002, "Alex"),
        _person(1050, "Jo", household=150),
        # Casey's OWN household is 150 (unrelated to the line's 100), but their PRIMARY
        # CHILDHOOD household is 100 — Ruling 2a: fetch_household_persons' real pool is own OR
        # childhood household, so Casey belongs to family {100} even though Jo (also household
        # 150, no childhood link) does not.
        _person(1060, "Casey", household=150, primary_childhood_household=100),
    ]

    async def _household_persons(_year: int, household_ids: Collection[int]) -> list[Any]:
        """Ruling 2a: a stand-in for the real fetch_household_persons, which scopes to the
        household set actually asked for — own household OR a childhood household — unlike a
        static AsyncMock. This is what lets both the "not in the family" refusal (Jo) and the
        childhood-household acceptance (Casey) mean something: a plain household_id comparison
        would get Jo right but Casey wrong (and vice versa for a pool with no filtering at all)."""
        wanted = set(household_ids)
        return [
            p for p in persons if p.household_id in wanted or getattr(p, "primary_childhood_household", 0) in wanted
        ]

    repo.fetch_household_persons = AsyncMock(side_effect=_household_persons)
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
    assert second.data["program_family"] == "summer"  # every one of Alex's enrollments is summer
    assert spy.kwargs["actor"] == ACTOR


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
    that reverts place() to a plain household_id comparison: Casey's own household is 150 (not
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
