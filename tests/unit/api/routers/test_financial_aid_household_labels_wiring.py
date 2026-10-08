"""Ruling D (owner 10-06): To place, the Ledger and the Grants Register name a family by the household card's label,
from the household page's own helper (household_labels) over the repository that reads CampMinder's adults. These pin
the routes' wiring; the services' own tests pin what they do with it. Fictional only."""

from __future__ import annotations

from functools import partial
from typing import Any
from unittest.mock import patch

import pytest

from api.services.financial_aid_household_page import household_labels
from api.services.financial_aid_repository import FinancialAidRepository


@pytest.fixture(autouse=True)
def _stop_patches() -> Any:
    yield
    patch.stopall()


def _labels_passed(service: str, build: str) -> Any:
    import api.routers.financial_aid as routes

    built = patch(f"api.routers.financial_aid.{service}").start()
    getattr(routes, build)()
    return built.call_args.kwargs["labels"]


@pytest.mark.parametrize(
    ("service", "build"),
    [("ToPlaceService", "_to_place"), ("MoneyLedgerService", "_money_ledger"), ("GrantsService", "_grants")],
)
def test_each_read_names_households_with_the_household_pages_helper(service: str, build: str) -> None:
    labels = _labels_passed(service, build)
    assert isinstance(labels, partial)
    assert labels.func is household_labels
    (reads,) = labels.args
    assert isinstance(reads, FinancialAidRepository)
