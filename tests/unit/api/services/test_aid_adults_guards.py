"""Guards on households.aid_adults: the adults the persons sync names for Camperships (pocketbase/sync/aid_adults.go).

The field is hidden from non-superusers, but the FastAPI service reads PocketBase as a superuser, so a whole-record
read would carry it. These pin that every Python household read names its columns, that only the Camperships household
page asks for aid_adults, and that the field name appears only where it is allowed to. Fictional data only."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.constants.collections import HOUSEHOLD_COLUMNS
from api.dependencies import lodging_cache
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.lodging_repository import LodgingRepository

ROOT = Path(__file__).resolve().parents[4]
PB_TYPES = ROOT / "frontend" / "src" / "types" / "pocketbase-types.ts"


@pytest.fixture(autouse=True)
def _reset_lodging_cache() -> Any:
    lodging_cache.invalidate_all()
    yield
    lodging_cache.invalidate_all()


def _pb() -> tuple[MagicMock, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []
    pb = MagicMock()

    def get_full_list(*args: Any, query_params: dict[str, Any], **kwargs: Any) -> list[Any]:
        calls.append(query_params)
        return []

    pb.collection.return_value.get_full_list.side_effect = get_full_list
    return pb, calls


def _fields(params: dict[str, Any]) -> list[str]:
    return str(params.get("fields", "")).split(",")


def test_household_columns_are_every_households_column_but_aid_adults() -> None:
    """A households column added later must join HOUSEHOLD_COLUMNS, or every named read silently drops it."""
    record = re.search(r"export type HouseholdsRecord(?:<[^>]*>)? = \{(.*?)\n\}", PB_TYPES.read_text(), re.DOTALL)
    assert record is not None
    columns = set(re.findall(r"^\s+(\w+)\??:", record.group(1), re.MULTILINE))
    assert "aid_adults" in columns
    assert set(HOUSEHOLD_COLUMNS.split(",")) == columns - {"aid_adults"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "read",
    [
        lambda repo: repo.fetch_households(2026),
        lambda repo: repo.fetch_households_by_ids(["hh_1"]),
        lambda repo: repo.fetch_household_by_cm_id(2026, 1000001),
    ],
    ids=["fetch_households", "fetch_households_by_ids", "fetch_household_by_cm_id"],
)
async def test_lodging_household_reads_name_their_columns_without_aid_adults(read: Any) -> None:
    pb, calls = _pb()
    await read(LodgingRepository(pb))
    assert len(calls) == 1
    assert _fields(calls[0]) == HOUSEHOLD_COLUMNS.split(",")


@pytest.mark.asyncio
async def test_aid_household_reads_name_their_columns_and_add_aid_adults_only_when_asked() -> None:
    pb, calls = _pb()
    repo = FinancialAidRepository(pb)
    await repo.fetch_households(2026, [1000001])
    await repo.fetch_households(2026, [1000001], adults=True)
    plain, with_adults = calls
    assert _fields(plain) == HOUSEHOLD_COLUMNS.split(",")
    assert _fields(with_adults) == [*HOUSEHOLD_COLUMNS.split(","), "aid_adults"]


# Where the field name may appear outside tests. A new reader is a decision, not a drive-by: add it here on purpose.
ALLOWED = {
    "pocketbase/pb_migrations/1500000232_households_aid_adults.js",  # the field
    "pocketbase/sync/aid_adults.go",  # its one writer
    "pocketbase/sync/persons.go",  # which the persons sync calls
    "pocketbase/audit/diff.go",  # the audit log drops it
    "scripts/setup/synthetic/anonymizer.py",  # the synthetic DB fakes it
    "scripts/setup/synthetic/scan_leaks.py",  # and the leak scan denylists its real names
    "api/services/financial_aid_repository.py",  # its one Python read (fetch_households(adults=True))
    "api/services/financial_aid_household_page.py",  # its one consumer: the household page, and its label helper
    "frontend/src/types/pocketbase-types.ts",  # generated from the schema
}
SCANNED = ("api", "bunking", "scripts", "pocketbase", "frontend/src", "docker")
SKIPPED_DIRS = {"node_modules", "pb_data", "__pycache__", ".venv", "dist", "pb_types_tmp"}
SUFFIXES = {".py", ".go", ".js", ".ts", ".tsx", ".json", ".sh", ".yml", ".yaml", ".sql"}


def _sources(top: Path) -> list[Path]:
    out: list[Path] = []
    for path in top.rglob("*"):
        if any(part in SKIPPED_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.is_file() and path.suffix in SUFFIXES and not path.name.endswith("_test.go"):
            out.append(path)
    return out


def test_aid_adults_appears_only_where_it_is_allowed() -> None:
    found = {
        str(path.relative_to(ROOT))
        for top in SCANNED
        if (ROOT / top).is_dir()
        for path in _sources(ROOT / top)
        if "aid_adults" in path.read_text(errors="ignore")
    }
    assert found <= ALLOWED, f"aid_adults outside its allowed files: {sorted(found - ALLOWED)}"
    # Every allowed file still uses it: a stale entry would widen the list unnoticed.
    assert found == ALLOWED


def test_campminders_adults_reach_a_response_only_through_the_household_page() -> None:
    """HouseholdAdultOut (a household's adults by role) is a household-page model and nothing else in the API
    returns it."""
    found = {
        str(path.relative_to(ROOT))
        for path in _sources(ROOT / "api")
        if "HouseholdAdultOut" in path.read_text(errors="ignore")
    }
    assert found == {"api/schemas/financial_aid_household_page.py", "api/services/financial_aid_household_page.py"}
