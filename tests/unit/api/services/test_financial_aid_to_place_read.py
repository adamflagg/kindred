"""Money > To place, the read (campership SP11-rest; clean spec §8.1; D12, D26, D58, D62). Fictional only.
Figures: Session 2 (1000101) gives a tier-2 family Round 1 = 1,500; Emma (1000011) is in household 1000001."""

from __future__ import annotations

from datetime import date

import pytest

from api.services.financial_aid_to_place import MISMATCH_FLAG, LineDetail
from tests.unit.api.services.decisions_fakes import seed_line
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.to_place_fakes import EMMA, MAR8, one_line, to_place_service

# --- the read ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_read_groups_the_open_lines_by_reason_with_their_names() -> None:
    store = one_line()
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)  # no request behind it
    seed_line(store, 9003, "200", person=0, posted=MAR8)
    store.details[9003] = LineDetail(9003, "camp fa quest", (MISMATCH_FLAG,))
    out = await to_place_service(store).read(YEAR)
    assert [(g.reason, g.count, g.total) for g in out.groups] == [
        ("several", 1, 1500.0),
        ("no_request", 1, 700.0),
        ("program_mismatch", 1, 200.0),
    ]
    assert [g.label for g in out.groups] == [
        "Several requests could take this",
        "No request behind it",
        "The description names a program this camper isn't in",
    ]
    assert (out.open_count, out.open_total) == (3, 2400.0)
    (line,) = out.groups[0].lines
    assert (line.family, line.person, line.description, line.posted_on) == (
        "Family 1000001",
        "",
        "Camp FA",
        date(2027, 3, 8),
    )
    (candidate,) = line.candidates
    assert (candidate.camper, candidate.session, candidate.not_yet_in_campminder) == (
        "Camper 1000011",
        "Session 2",
        1500.0,
    )
    assert line.suggestion is not None
    assert [(p.request_id, p.amount) for p in line.suggestion.parts] == [(EMMA, 1500.0)]
    # §4.10: what confirming it would lock, worked out as the write works it out
    assert [(t.request_id, t.round, t.amount) for t in line.suggestion.would_tick] == [(EMMA, 1, 1500.0)]
    assert line.suggestion.would_leave == []


@pytest.mark.asyncio
async def test_a_season_before_ticks_began_has_no_to_place() -> None:
    """SP10b Decision 9: 2026's money was never ticked and its decisions load from the sheet (D67)."""
    out = await to_place_service(one_line()).read(2026)
    assert (out.open_count, out.groups, out.skipped) == (
        0,
        [],
        "2026 predates To place (the first ticked season is 2027)",
    )


@pytest.mark.asyncio
async def test_a_household_page_sees_only_its_own_scope() -> None:
    store = one_line()
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)
    out = await to_place_service(store).read(YEAR, household_cm_id=1000001)
    assert out.household_cm_id == 1000001
    assert [ln.transaction_cm_id for g in out.groups for ln in g.lines] == [9001]


def test_candidate_figure_is_called_not_yet_in_campminder():
    """Owner ruling 2026-10-01: staff read the figure as "not yet in CampMinder", never "still due"."""
    from api.schemas.financial_aid_to_place import CandidateOut

    assert "not_yet_in_campminder" in CandidateOut.model_fields
    assert "still_due" not in CandidateOut.model_fields
    description = CandidateOut.__doc__ or ""
    assert "not yet in CampMinder" in description
    assert "still due" not in description.lower()
