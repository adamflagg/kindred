"""Finance's "as reported" history catalogue (clean spec §5.6, §9.5, §9.7; O-930-13's default): dollars and counts
typed once, each with its as-of date; Kindred computes every %. Fictional figures only."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from bunking.financial_aid.reports.history import (
    ENTITY_MAX,
    METRICS,
    METRICS_BY_KEY,
    ReportedFigure,
    figure_entity,
    problems,
)

BUDGET = ReportedFigure(
    year=2025,
    view="finance",
    metric="budget",
    pool="",
    tier=0,
    phase=0,
    at="season_end",
    as_of=date(2025, 10, 10),
    value=Decimal(900000),
    source="year-end deck",
)


def test_a_well_formed_figure_has_no_problems() -> None:
    assert problems(BUDGET) == []
    assert problems(replace(BUDGET, pool="camp_pool")) == []


def test_finances_only_typed_percentages_are_its_target_bands() -> None:
    """§9.7: finance's history is typed as dollars and counts; the band is finance's own target (§5.3, D120)."""
    percents = {m.key for m in METRICS if m.unit == "percent" and m.view == "finance"}
    assert percents == {"phase_band_low", "phase_band_high"}


@pytest.mark.parametrize(
    ("change", "says"),
    [
        ({"metric": "made_up"}, "not a reported metric"),
        ({"view": "development"}, "is a finance figure"),
        ({"at": "pull"}, "is read at season_end"),
        ({"tier": 3}, "has no tier"),
        ({"pool": "Camp Pool"}, "is not a pool key"),
        ({"value": Decimal(-1)}, "never negative"),
        ({"as_of": date(2021, 1, 1)}, "not in 2025's season"),
    ],
)
def test_a_figure_that_doesnt_fit_its_metric_is_refused(change: dict[str, object], says: str) -> None:
    found = problems(replace(BUDGET, **change))  # type: ignore[arg-type]
    assert any(says in p for p in found), found


def test_a_phase_figure_needs_a_phase_and_a_count_is_whole() -> None:
    phase = replace(BUDGET, metric="phase_awarded", value=Decimal(500000))
    assert any("needs a phase" in p for p in problems(phase))
    assert problems(replace(phase, phase=1)) == []
    apps = replace(BUDGET, metric="r1_apps", value=Decimal("410.5"), at="pull")
    assert any("is a count" in p for p in problems(apps))
    band = replace(BUDGET, metric="phase_band_high", phase=1, value=Decimal(101))
    assert any("0 to 100" in p for p in problems(band))


def test_a_phase_figure_is_read_at_a_deck_pull_or_the_season_end_and_a_band_only_at_the_end() -> None:
    """Owner N2 = C: RPT-1's As offered is a pull, its End of season the season_end figure; a band is not a pull."""
    phase = replace(BUDGET, metric="phase_awarded", phase=1, value=Decimal(250000))
    assert problems(replace(phase, at="pull")) == []
    assert problems(replace(phase, at="season_end")) == []
    band = replace(BUDGET, metric="phase_band_low", phase=1, value=Decimal(50))
    assert any("not pull" in p for p in problems(replace(band, at="pull")))


def test_the_natural_key_ignores_the_value_source_and_note() -> None:
    assert replace(BUDGET, value=Decimal(1), source="x", note="y").key == BUDGET.key
    assert replace(BUDGET, as_of=date(2025, 10, 11)).key != BUDGET.key


def test_every_metric_cites_its_reporting_items() -> None:
    """An RPT-n item (§9.7) or the spec section that defines the line (development's rows, §9.4)."""
    for metric in METRICS:
        assert metric.rpt, metric.key
        assert all(re.fullmatch(r"RPT-\d+|§\d+\.\d+", r) for r in metric.rpt), metric.key
        assert METRICS_BY_KEY[metric.key] is metric


def test_the_change_log_key_fits_64_characters_for_the_longest_figure() -> None:
    """aid_change_log.entity_id holds 64 characters (C1 of the plan review): the longest metric, the longest view and
    a 60-character pool still fit, and two figures that differ only in their pool keep apart."""
    longest = max(METRICS, key=lambda m: (len(m.key), len(m.view)))
    pool = "p" * 60
    figure = replace(BUDGET, metric=longest.key, view=longest.view, pool=pool, tier=50, phase=3, at="pull")
    assert len(figure_entity(figure)) <= ENTITY_MAX == 64
    assert figure_entity(figure) != figure_entity(replace(figure, pool="q" * 60))
    assert figure_entity(BUDGET).startswith("2025:finance:budget:")
