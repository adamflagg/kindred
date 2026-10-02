"""Money › Sources' rows (campership slice 3 back-end PR-B, ask 2; clean spec §5.7, §8.1; D88, D100, D105), and
the descriptions Today's finance line counts as needing a group (ask 3). Fictional only."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.financial_aid_ledger_service import FinancialAidLedgerService, needs_group, source_row, who_paid


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
