"""Owner ruling L (10-08): typed history names Development's any-aid count "Grants/Awards", as the report does."""

from __future__ import annotations

from bunking.financial_aid.reports.history import METRICS


def test_developments_typed_awards_count_is_called_grants_and_awards() -> None:
    found = [m for m in METRICS if m.view == "development" and m.key == "awards"]
    assert [m.label for m in found] == ["Grants/Awards"]
