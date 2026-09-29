"""Grants service (sub-project 6-core): the grantor directory, the register read, placements
and commitments. Fictional data only; every write runs the real 4a helper over a fake batch."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid_grants import GrantorCreate, GrantorSave
from api.services.financial_aid_grants_service import GrantorKeyTakenError, GrantsService
from api.services.financial_aid_ledger_service import FinancialAidNotFoundError
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
