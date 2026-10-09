"""Owner ruling L (10-08): typed history names Development's any-aid count "Grants/Awards", as the report does."""

from __future__ import annotations

from bunking.financial_aid.reports.history import METRICS


def test_developments_typed_awards_count_is_called_grants_and_awards() -> None:
    found = [m for m in METRICS if m.view == "development" and m.key == "awards"]
    assert [m.label for m in found] == ["Grants/Awards"]


def test_developments_typed_lines_carry_the_reports_words() -> None:
    """Final audit O2: a typed line is named as the report's row names it (development-v2's words), so what
    development types is what the report shows; the recipients line counts recipients, never "Applications"."""
    labels = {m.key: m.label for m in METRICS if m.view == "development"}
    assert labels["total_awards"] == "Total Awards Granted (all money)"
    assert labels["total_requests"] == "Total requests (demand) = Σ need"
    assert labels["recipients"] == "Recipients (attended and got money, any source)"
    assert labels["families"] == "Families (CampMinder households)"
    assert labels["appeals_submitted"] == "Appeals (asks in Round 2 or later, campers who attended)"
    assert labels["declined_insufficient"] == "Declined enrollment due to insufficient aid"
