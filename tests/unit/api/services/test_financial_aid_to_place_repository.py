"""The repository reads To place adds (campership SP11-rest): each line's description and flags, the
overrides in full, the lines left at family level, and the source registry. Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_reconciliation import SplitPart
from api.services.financial_aid_to_place import (
    GrantLineRow,
    LeftLine,
    LineDetail,
    LinkRow,
    OverrideRow,
    SinceCorrection,
    SinceLog,
    SinceRecords,
    SourceRow,
    Synced,
    SyncRemoval,
)

YEAR = 2027


def _repo(rows: list[Any]) -> tuple[FinancialAidDecisionsRepository, MagicMock]:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = rows
    return FinancialAidDecisionsRepository(pb), pb


@pytest.mark.asyncio
async def test_line_details_are_the_camp_aid_lines_descriptions_and_flags() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(transaction_cm_id=9001, effective_source_key="camp fa", flags=["implied_program_mismatch"]),
            SimpleNamespace(transaction_cm_id=9002, effective_source_key="camp fa", flags='["positive_amount"]'),
            SimpleNamespace(transaction_cm_id=9003, effective_source_key="camp fa", flags=None),
            SimpleNamespace(transaction_cm_id=9001, effective_source_key="camp fa", flags=["positive_amount"]),
        ]
    )
    assert await repo.fetch_line_details(YEAR) == {
        9001: LineDetail(9001, "camp fa", ("implied_program_mismatch", "positive_amount")),  # every row's flags
        9002: LineDetail(9002, "camp fa", ("positive_amount",)),
        9003: LineDetail(9003, "camp fa", ()),
    }
    pb.collection.assert_called_with("aid_postings")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query["filter"] == f"year = {YEAR} && funder_type = 'camp'"
    assert set(query["fields"].split(",")) == {"transaction_cm_id", "effective_source_key", "flags"}


@pytest.mark.asyncio
async def test_override_rows_are_read_whole_with_their_split() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(
                id="ovr000000009001",
                transaction_cm_id=9001,
                attributed_person_cm_id=0,
                attributed_session_cm_id=0,
                program_family="",
                source_key_override="",
                source="staff",
                note="Two campers",
                split=[{"person_cm_id": 1000011, "session_cm_id": 1000101, "program_family": "summer", "amount": "10"}],
            )
        ]
    )
    assert await repo.fetch_override_rows(YEAR) == {
        9001: OverrideRow(
            id="ovr000000009001",
            transaction_cm_id=9001,
            attributed_person_cm_id=0,
            attributed_session_cm_id=0,
            program_family="",
            source_key_override="",
            source="staff",
            note="Two campers",
            split=(SplitPart(1000011, 1000101, "summer", Decimal(10)),),
        )
    }
    pb.collection.assert_called_with("aid_attribution_overrides")


@pytest.mark.asyncio
async def test_only_to_place_dispositions_are_lines_left_at_family_level() -> None:
    repo, _ = _repo(
        [
            SimpleNamespace(
                id="dsp000000000001",
                transaction_cm_id=9001,
                flag="to_place",
                disposition="accepted_let_stand",
                note="Pays it in June",
            ),
            SimpleNamespace(
                id="dsp000000000002",
                transaction_cm_id=9002,
                flag="positive_amount",
                disposition="accepted_let_stand",
                note="Let stand",
            ),
            SimpleNamespace(
                id="dsp000000000003",
                transaction_cm_id=9003,
                flag="to_place",
                disposition="accepted_other",
                note="Not a left line",
            ),
        ]
    )
    assert await repo.fetch_left_lines(YEAR) == {9001: LeftLine("dsp000000000001", 9001, "Pays it in June")}


@pytest.mark.asyncio
async def test_source_rows_say_whether_each_description_is_classified_aid() -> None:
    repo, pb = _repo(
        [
            SimpleNamespace(
                description_key="camp fa",
                description="Camp FA",
                classified_by="config_file",
                counts_as_aid=True,
                funder_type="camp",
            ),
            SimpleNamespace(
                description_key="new description",
                description="New Description",
                classified_by="unclassified",
                counts_as_aid=False,
                funder_type="unknown",
            ),
        ]
    )
    assert await repo.fetch_source_rows() == {
        "camp fa": SourceRow("camp fa", "Camp FA", classified=True, counts_as_aid=True, funder_type="camp"),
        "new description": SourceRow(
            "new description", "New Description", classified=False, counts_as_aid=False, funder_type="unknown"
        ),
    }
    pb.collection.assert_called_with("aid_sources")


# --- D16b: what changed since a posting day -------------------------------------------------------------------

FLOOR = datetime(2027, 3, 9, 7, 59, 59, 999999, tzinfo=UTC)  # the end of Mar 8, camp time
LATER = "2027-03-09 17:00:00.000Z"
EARLIER = "2027-02-01 17:00:00.000Z"


def _by_collection(
    rows: dict[str, list[Any]],
) -> tuple[FinancialAidDecisionsRepository, dict[str, list[dict[str, Any]]]]:
    """A PocketBase whose every collection answers its own rows, recording each read's query."""
    queries: dict[str, list[dict[str, Any]]] = {}
    pb = MagicMock()

    def collection(name: str) -> MagicMock:
        handle = MagicMock()

        def get_full_list(*args: Any, query_params: dict[str, Any], **kwargs: Any) -> list[Any]:
            queries.setdefault(name, []).append(query_params)
            return rows.get(name, [])

        handle.get_full_list.side_effect = get_full_list
        return handle

    pb.collection.side_effect = collection
    return FinancialAidDecisionsRepository(pb), queries


def _row(**fields: Any) -> SimpleNamespace:
    return SimpleNamespace(**fields)


@pytest.mark.asyncio
async def test_what_changed_since_is_read_once_per_collection_year_scoped_and_after_the_floor() -> None:
    repo, queries = _by_collection(
        {
            "aid_change_log": [
                _row(entity="aid_requests", entity_id="reqemma00000001", action="update", created=LATER),
            ],
            "aid_application_corrections": [_row(application="app000001000001", request="", created=LATER)],
            "attendees": [
                _row(
                    person_id=1000011,
                    created=EARLIER,
                    updated=LATER,
                    expand={"person": _row(household_id=1000001), "session": _row(cm_id=1000101)},
                )
            ],
            "person_custom_values": [_row(created=LATER, updated=LATER, expand={"person": _row(cm_id=1000011)})],
            "camp_sessions": [_row(cm_id=1000101, created=EARLIER, updated=LATER)],
            "aid_postings": [
                _row(
                    transaction_cm_id=7001,
                    household_cm_id=1000001,
                    person_cm_id=1000011,
                    attributed_person_cm_id=0,
                    effective_source_key="regional grant",
                    created=EARLIER,
                    updated=LATER,
                )
            ],
            "aid_sources": [_row(description_key="regional grant", created=EARLIER, updated=LATER)],
            "aid_household_links": [
                _row(household_cm_id=1000001, family_key="fam-a", excluded=False, created=EARLIER, updated=EARLIER)
            ],
            "sync_runs": [_row(service="persons", ended=LATER)],
        }
    )
    records = await repo.fetch_changed_since(YEAR, FLOOR, persons=False)
    at = datetime(2027, 3, 9, 17, 0, tzinfo=UTC)
    before = datetime(2027, 2, 1, 17, 0, tzinfo=UTC)
    assert records == SinceRecords(
        log=(SinceLog("aid_requests", "reqemma00000001", "update", at),)
        * 2,  # the plain read and the before/after read
        corrections=(SinceCorrection("app000001000001", "", at),),
        synced=(
            Synced("attendees", at, person_cm_id=1000011, household_cm_id=1000001, session_cm_id=1000101),
            Synced("person_custom_values", at, person_cm_id=1000011),
            Synced("camp_sessions", at, session_cm_id=1000101),
            Synced("aid_sources", at, key="regional grant"),
        ),
        grant_lines=(GrantLineRow(7001, 1000001, 1000011, 0, "regional grant", before, at),),
        links=(LinkRow(1000001, "fam-a", False, before),),
        removals=(SyncRemoval("persons", at),),
    )
    assert "persons" not in queries  # the rules read no person field: persons' daily churn is not read at all
    since = "'2027-03-09 07:59:59.999Z'"
    for name, reads in queries.items():
        for query in reads:
            assert len(query["filter"]) < 3500, name
            if name not in ("aid_sources", "aid_grantors", "sync_runs"):  # directories span seasons
                assert f"year = {YEAR}" in query["filter"], name
            if name != "aid_household_links":  # every link is read: the family is today's
                assert since in query["filter"], name
    assert "field_definition.cm_id" in queries["person_custom_values"][0]["filter"]  # equity fields only
    # Every funder type: a grant line Go moved into camp aid after the posting day is a grant that moved (review fix 1)
    assert "funder_type" not in queries["aid_postings"][0]["filter"]
    runs = queries["sync_runs"][0]["filter"]
    assert "deleted_count > 0" in runs
    for service in (
        "attendees",
        "persons",
        "person_custom_values",
        "person_custom_values_family_camp",
        "sessions",
        "aid_postings",
    ):
        assert f"service = '{service}'" in runs
    logs = [q["filter"] for q in queries["aid_change_log"]]
    assert all("aid_rules" not in f for f in logs)
    assert sorted("before" in q["fields"] for q in queries["aid_change_log"]) == [False, True]


@pytest.mark.asyncio
async def test_a_correction_since_the_floor_is_read_with_its_field() -> None:
    """changed_since skips an Include override by its field (it changes no price), so the trimmed read must
    fetch `field`: PocketBase returns only the fields asked for, and a missing one reads as "" here."""
    repo, queries = _by_collection(
        {
            "aid_application_corrections": [
                _row(application="app000001000001", request="reqemma00000001", field="include_override", created=LATER)
            ]
        }
    )
    records = await repo.fetch_changed_since(YEAR, FLOOR, persons=False)
    (query,) = queries["aid_application_corrections"]
    assert "field" in query["fields"].split(",")
    at = datetime(2027, 3, 9, 17, 0, tzinfo=UTC)
    assert records.corrections == (SinceCorrection("app000001000001", "reqemma00000001", at, "include_override"),)


@pytest.mark.asyncio
async def test_grantors_are_read_from_their_own_records_not_by_season() -> None:
    """A grantor's log row carries the season configured when it was saved (the directory spans seasons), so
    a season-scoped log read can miss a grantor change behind a late placement: read the record's `updated`."""
    repo, queries = _by_collection({"aid_grantors": [_row(key="regional_fund", created=EARLIER, updated=LATER)]})
    records = await repo.fetch_changed_since(YEAR, FLOOR, persons=False)
    at = datetime(2027, 3, 9, 17, 0, tzinfo=UTC)
    assert Synced("aid_grantors", at, key="regional_fund") in records.synced
    (query,) = queries["aid_grantors"]
    assert "year" not in query["filter"]
    assert "'2027-03-09 07:59:59.999Z'" in query["filter"]


@pytest.mark.asyncio
async def test_persons_are_read_only_when_the_rules_read_a_person_field() -> None:
    repo, queries = _by_collection(
        {"persons": [_row(cm_id=1000011, household_id=1000001, created=EARLIER, updated=LATER)]}
    )
    records = await repo.fetch_changed_since(YEAR, FLOOR, persons=True)
    at = datetime(2027, 3, 9, 17, 0, tzinfo=UTC)
    assert records.synced == (Synced("persons", at, person_cm_id=1000011, household_cm_id=1000001),)
    assert len(queries["persons"]) == 1


@pytest.mark.asyncio
async def test_a_record_with_no_created_or_updated_time_is_a_named_error_not_a_bare_max_failure() -> None:
    repo, _ = _by_collection({"aid_grantors": [_row(key="regional_fund", created=None, updated="")]})
    with pytest.raises(ValueError, match="no created or updated time"):
        await repo.fetch_changed_since(YEAR, FLOOR, persons=False)
