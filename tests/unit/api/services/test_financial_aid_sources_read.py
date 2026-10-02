"""Money › Sources' rows (campership slice 3 back-end PR-B, ask 2; clean spec §5.7, §8.1; D88, D100, D105), and
the descriptions Today's finance line counts as needing a group (ask 3). Fictional only."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.financial_aid import SourceChangeOut
from api.services.financial_aid_ledger_service import FinancialAidLedgerService, needs_group, source_row, who_paid
from api.services.financial_aid_repository import FinancialAidRepository


def _source(
    key: str, record_id: str, *, funder: str = "outside", families: list[str] | None = None, **kw: Any
) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": record_id,
        "description_key": key,
        "description": key.title(),
        "source_name": key,
        "source_family": "camp_fa" if funder == "camp" else "other_outside",
        "funder_type": funder,
        "counts_as_aid": True,
        "counts_toward_budget": funder == "camp",
        "grantor_key": "",
        "implied_program_families": families if families is not None else [],
        "classified_by": "config_file",
        "note": "",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def _line(txn: int, key: str, amount: float, *, effective: str = "") -> SimpleNamespace:
    """A live aid_postings line (CampMinder's sign); `effective` is the description a reclassification gave it."""
    return SimpleNamespace(transaction_cm_id=txn, source_key=key, effective_source_key=effective or key, amount=amount)


def _repo(**values: Any) -> MagicMock:
    repo = MagicMock()
    for name in ("fetch_sources", "fetch_grantors", "fetch_source_changes", "fetch_postings"):
        setattr(repo, name, AsyncMock(return_value=values.get(name, [])))
    return repo


# --- the row's own facts (every read and write echo) ------------------------------------------------------


@pytest.mark.parametrize(
    ("funder", "families", "needs"),
    [
        ("outside", [], True),
        ("incentive", [], True),  # a source still typed incentive is outside money (D97)
        ("outside", ["summer"], False),
        ("camp", [], False),  # the camp's own aid sits in the budget's pools already
        ("unknown", [], False),  # unclassified: Today counts it as unclassified, not as needing a group
    ],
)
def test_an_outside_source_with_no_program_family_needs_a_group(funder: str, families: list[str], needs: bool) -> None:
    """D100, §8.1: "An outside source with no group is a 'needs a group' line here and on Today"."""
    assert needs_group(_source("regional grant", "src000000000001", funder=funder, families=families)) is needs


@pytest.mark.parametrize(
    ("funder", "paid"),
    [("camp", "the camp"), ("outside", "another funder"), ("incentive", "another funder"), ("unknown", None)],
)
def test_who_paid_is_the_camp_or_another_funder(funder: str, paid: str | None) -> None:
    """D88's first fact (§5.7: who paid, the camp or another funder), in DevelopmentSourceOut.who_paid's words."""
    assert who_paid(funder) == paid


def test_a_row_carries_its_own_facts() -> None:
    row = source_row(_source("regional grant", "src000000000001"))
    assert (row.needs_group, row.who_paid) == (True, "another funder")


# --- Today's count (season-scoped) --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_today_counts_a_description_needing_a_group_only_when_it_has_a_live_line_this_season() -> None:
    repo = _repo(
        fetch_sources=[
            _source("regional grant", "src000000000001"),
            _source("valley grant", "src000000000002"),  # needs a group, but no line this season
            _source("summer grant", "src000000000003", families=["summer"]),
            _source("camp fa", "src000000000004", funder="camp"),
        ],
        fetch_postings=[
            _line(9001, "camp fa", -700.0, effective="regional grant"),  # reclassified onto the regional grant
            _line(9002, "summer grant", -300.0),
            _line(9003, "camp fa", -500.0),
        ],
    )
    assert await FinancialAidLedgerService(repo).needs_group_sources(2027) == ["regional grant"]
    repo.fetch_postings.assert_awaited_once_with(2027)


# --- the list read: the season's lines, the grantor's name, the last change ----------------------------------


def _change(record_id: str, log_id: str, actor: str, reason: str, created: str) -> SimpleNamespace:
    """An aid_change_log row about an aid_sources record (entity_id = the record id)."""
    return SimpleNamespace(id=log_id, entity_id=record_id, actor=actor, reason=reason, created=created)


def _registry() -> MagicMock:
    return _repo(
        fetch_sources=[
            _source("camp fa", "src000000000001", funder="camp", families=["summer"]),
            _source("regional grant", "src000000000002", grantor_key="regional_fund"),
            _source("new aid line", "src000000000003", funder="unknown", classified_by="unclassified"),
        ],
        fetch_grantors=[SimpleNamespace(key="regional_fund", name="Regional Fund")],
        # newest first, on purpose: the read must take the latest, whatever order the rows come in
        fetch_source_changes=[
            _change(
                "src000000000002",
                "log000000000002",
                "finance@example.com",
                "Funds weekend families too",
                "2027-02-10 10:00:00.000Z",
            ),
            _change(
                "src000000000002",
                "log000000000001",
                "development@example.com",
                "First grouping",
                "2027-01-05 10:00:00.000Z",
            ),
        ],
        fetch_postings=[
            _line(9001, "camp fa", -1500.0),
            _line(9002, "camp fa", -700.0),
            _line(9003, "regional grant", -300.0),
            # reclassified: the grant's description classifies it now
            _line(9004, "camp fa", -200.0, effective="regional grant"),
        ],
    )


@pytest.mark.asyncio
async def test_the_registry_with_its_season_lines_grantor_and_last_change() -> None:
    repo = _registry()
    out = await FinancialAidLedgerService(repo).sources(2027)
    assert out.year == 2027
    assert [(s.description_key, s.lines, s.amount, s.grantor_name, s.who_paid, s.needs_group) for s in out.sources] == [
        ("camp fa", 2, 2200.0, "", "the camp", False),
        ("regional grant", 2, 500.0, "Regional Fund", "another funder", True),
        ("new aid line", 0, 0.0, "", None, False),
    ]
    assert out.sources[1].last_change == SourceChangeOut(
        by="finance@example.com", at=datetime(2027, 2, 10, 10, 0, tzinfo=UTC), note="Funds weekend families too"
    )
    assert (out.sources[0].last_change, out.sources[2].last_change) == (None, None)  # never edited in the app
    repo.fetch_postings.assert_awaited_once_with(2027)


@pytest.mark.asyncio
async def test_without_a_season_the_list_counts_no_lines_and_reads_no_postings() -> None:
    repo = _registry()
    out = await FinancialAidLedgerService(repo).sources()
    assert out.year is None
    assert [(s.lines, s.amount) for s in out.sources] == [(None, None)] * 3
    assert out.sources[1].grantor_name == "Regional Fund"
    repo.fetch_postings.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_last_change_read_asks_the_log_for_source_writes_of_every_season() -> None:
    """A source spans seasons, and each write logs under the season current then, so no year filter."""
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidRepository(pb).fetch_source_changes()
    pb.collection.assert_called_with("aid_change_log")
    params = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert (params["filter"], params["sort"]) == ('entity = "aid_sources"', "created,id")
