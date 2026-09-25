"""Parity for matching a typed write-in name to an adult Jotform filing
(kindred#2839 follow-up: the board's "From Jotform" picker).

The server folds each filing's names into `suggest_write_in`'s exact tiers
(`name_tiers`); the board's write-in box folds what staff type and matches it
against them in `frontend/src/components/weekend/filerMatch.ts`. Both sides
read `tests/fixtures/jotform_filer_match_cases.json`, so the fold, the
Jaro-Winkler score, the tiers and the decisions are pinned in one file.
Fictional names only.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from rapidfuzz.distance import JaroWinkler

from api.schemas.jotform import JotformWriteInOption
from api.services.jotform_bunking import fold
from api.services.jotform_queue import (
    SIMILAR_THRESHOLD,
    QueueSubmission,
    WriteInRow,
    _exact_write_in_hits,
    _similar_write_in,
    name_tiers,
    suggest_write_in,
)

FIXTURE = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "jotform_filer_match_cases.json"
CASES: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
SESSION = 1000002


def _sub(index: int, first: str, last: str, nametag: str) -> QueueSubmission:
    return QueueSubmission(
        record_id=f"r{index}",
        submission_id=f"660000000000000{index:04d}",
        session_cm_id=SESSION,
        submitted_at="2026-08-31 09:00:00",
        first=first,
        last=last,
        nametag=nametag,
    )


def _typed_option(typed: str) -> JotformWriteInOption:
    return JotformWriteInOption(
        option_id=f"u_cedar/{typed.strip()}", session_cm_id=SESSION, unit_id="u_cedar", occupant_name=typed.strip()
    )


def test_the_threshold_is_the_servers() -> None:
    assert CASES["similar_threshold"] == SIMILAR_THRESHOLD


@pytest.mark.parametrize(("raw", "folded"), CASES["fold"])
def test_fold(raw: str, folded: str) -> None:
    assert fold(raw) == folded


@pytest.mark.parametrize(("a", "b", "score"), CASES["jaro_winkler"])
def test_jaro_winkler(a: str, b: str, score: float) -> None:
    assert JaroWinkler.similarity(a, b) == pytest.approx(score, abs=1e-12)


@pytest.mark.parametrize("case", CASES["tiers"], ids=lambda c: f"{c['first']}-{c['nametag']}")
def test_name_tiers(case: dict[str, Any]) -> None:
    assert name_tiers(_sub(0, case["first"], case["last"], case["nametag"])) == case["tiers"]


@pytest.mark.parametrize("case", CASES["match"], ids=lambda c: c["name"])
def test_each_decision_agrees_with_the_write_in_direction(case: dict[str, Any]) -> None:
    """The board matches name -> filing; the Requests tab matches filing ->
    write-in. A decision the vectors pin must read the same from the Requests
    tab's side: an exact pick is one `suggest_write_in` would make for a
    write-in of that name, and a similar pick one no exact tier finds and
    `_similar_write_in` would offer."""
    subs = [_sub(i, **CASES["filings"][key]) for i, key in enumerate(case["filings"])]
    expect = case["expect"]
    if case["typed"].strip() == "":
        assert expect["kind"] == "none"
        return
    option = _typed_option(case["typed"])
    if expect["kind"] == "exact":
        assert suggest_write_in(subs[expect["filing"]], [option]) == option.option_id
    elif expect["kind"] == "similar":
        assert all(not _exact_write_in_hits(sub, [option]) for sub in subs)
        row = WriteInRow(unit_id="u_cedar", unit_name="", occupant_name=option.occupant_name, session_cm_id=SESSION)
        assert _similar_write_in(subs[expect["filing"]], {option.option_id: row}) == option.option_id
