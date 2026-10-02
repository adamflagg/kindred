"""Development's as-reported rows in the history catalogue (Reports back end, Part B; clean spec §9.4, §9.5; D96,
D102): typed once per season and group, each with its as-of date. Fictional figures only."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from bunking.financial_aid.reports.history import METRICS, ReportedFigure, problems


def _figure(metric: str, value: str, *, pool: str = "camp_pool") -> ReportedFigure:
    return ReportedFigure(2025, "development", metric, pool, 0, 0, "season_end", date(2025, 9, 29), Decimal(value))


def test_development_types_its_lines_per_group() -> None:
    assert problems(_figure("total_awards", "900000")) == []
    assert problems(_figure("recipients", "400")) == []
    assert any("is a finance figure" in p for p in problems(_figure("budget", "1")))


def test_need_met_is_development_only_and_typed_against_the_summer_group() -> None:
    """§9.5: % of need met before 2026 is "as reported only (no per-round asks)"; it is typed with the summer group's
    pool, the row that shows it (plan review I3), as TLI + SCIT is."""
    assert problems(_figure("need_met", "70.0")) == []
    for metric in ("teen_programs",):
        assert problems(_figure(metric, "12")) == [], metric
    development_percents = {m.key for m in METRICS if m.unit == "percent" and m.view == "development"}
    assert development_percents == {"need_met"}


def test_teens_and_youth_are_never_typed() -> None:
    """D158: every season's ages are Kindred's by age, so the old teen-program counts can't be loaded as teens."""
    for metric in ("teens", "youth"):
        assert any("is not a reported metric" in p for p in problems(_figure(metric, "12"))), metric


def test_a_dated_pull_is_allowed_for_developments_as_of_columns() -> None:
    """§9.4: development's hand-made "as of" columns."""
    pulled = ReportedFigure(2025, "development", "total_awards", "", 0, 0, "pull", date(2025, 4, 12), Decimal(1))
    assert problems(pulled) == []
