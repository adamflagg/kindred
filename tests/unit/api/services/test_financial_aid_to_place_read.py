"""Money > To place, the read (campership SP11-rest; clean spec §8.1; D12, D26, D58, D62). Fictional only.
Figures: Session 2 (1000101) gives a tier-2 family Round 1 = 1,500; Emma (1000011) is in household 1000001."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from api.schemas.financial_aid_to_place import ToPlaceLineOut
from api.services.financial_aid_to_place import MISMATCH_FLAG, LeftLine, LineDetail
from tests.unit.api.services.decisions_fakes import seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.to_place_fakes import EMMA, MAR8, FakeLabels, one_line, to_place_service

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
    # Final UX (owner 10-09, answers-requests-money section 3): the mock's group headings.
    assert [g.label for g in out.groups] == [
        "Several requests could take this line",
        "No request behind this line",
        "The description names another program",
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
    # Final UX (design-language section 14): the client shortens the session by its type, so the candidate carries it.
    assert candidate.session_type == "main"
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
        "2026 predates To place, which starts in 2027",
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


# --- naming the family (ruling D, owner 10-06) ----------------------------------------------------
# To place names a line's family by the household card's label, from the household page's own helper: the adults'
# names, else the mailing title, with a tie-break only where two households in the same response read the same.

BECKERS = "Liam & Olivia Becker"


@pytest.mark.asyncio
async def test_each_line_names_its_family_by_the_household_pages_label() -> None:
    store = one_line()
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)  # no request behind it
    seed_line(store, 9003, "300", household=1000007, person=0, posted=MAR8)  # left at family level
    store.left[9003] = LeftLine("dis000000009003", 9003, "The family pays it down")
    labels = FakeLabels({1000001: BECKERS, 1000009: BECKERS})
    out = await to_place_service(store, labels=labels).read(YEAR)
    lines = {ln.transaction_cm_id: ln for ln in [*(ln for g in out.groups for ln in g.lines), *out.left]}
    assert {t: (ln.household_label, ln.household_label_tiebreak) for t, ln in lines.items()} == {
        9001: (BECKERS, "#1000001"),
        9002: (BECKERS, "#1000009"),
        9003: ("Adults 1000007", ""),
    }
    assert lines[9001].family == "Family 1000001"  # the old name stays as it was
    assert labels.calls == [frozenset({1000001, 1000007, 1000009})]  # one call: the response's households
    assert out.groups[0].label == "Several requests could take this line"  # the group's own label is the reason's


@pytest.mark.asyncio
async def test_a_household_pages_to_place_breaks_ties_only_among_its_own_lines() -> None:
    store = one_line()
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)
    labels = FakeLabels({1000001: BECKERS, 1000009: BECKERS})
    out = await to_place_service(store, labels=labels).read(YEAR, household_cm_id=1000001)
    (line,) = [ln for g in out.groups for ln in g.lines]
    assert (line.household_label, line.household_label_tiebreak) == (BECKERS, "")
    assert labels.calls == [frozenset({1000001})]


def test_a_lines_household_label_defaults_to_empty() -> None:
    """A field the frontend's exhaustive fixtures don't name yet must not be required."""
    assert ToPlaceLineOut.model_fields["household_label"].default == ""
    assert ToPlaceLineOut.model_fields["household_label_tiebreak"].default == ""


# --- the opened row's extra facts (ux3 to-place-10): display-only, they change no total, count or class ------


@pytest.mark.asyncio
async def test_a_candidate_carries_each_rounds_status_and_amount() -> None:
    """The mock's second meta line under a candidate ("R1 Posted $1,420 · R2 decided $780") is built from these."""
    out = await to_place_service(one_line()).read(YEAR)
    (candidate,) = out.groups[0].lines[0].candidates
    assert [(r.round, r.status, r.amount) for r in candidate.rounds] == [(1, "needs_offer", 1500.0)]


@pytest.mark.asyncio
async def test_a_line_carries_its_postings_note() -> None:
    store = one_line()
    store.details[9001] = LineDetail(9001, "camp fa", (), note="full-ride program")
    out = await to_place_service(store).read(YEAR)
    assert out.groups[0].lines[0].posting_note == "full-ride program"
    store.details[9001] = LineDetail(9001, "camp fa")
    out = await to_place_service(store).read(YEAR)
    assert out.groups[0].lines[0].posting_note == ""


@pytest.mark.asyncio
async def test_a_line_posted_just_after_a_reversal_says_what_was_reversed() -> None:
    store = one_line()  # 9001 posted Mar 8
    seed_line(store, 9000, "1500", person=0, posted=datetime(2027, 3, 1, 18, 0, tzinfo=UTC), reversed_at=MAR8)
    seed_line(store, 8999, "100", household=1000009, person=0, posted=MAR8, reversed_at=MAR8)  # another family's
    out = await to_place_service(store).read(YEAR)
    line = next(ln for g in out.groups for ln in g.lines if ln.transaction_cm_id == 9001)
    assert [(r.amount, r.reversed_on) for r in line.reposted_after] == [(1500.0, date(2027, 3, 8))]


@pytest.mark.asyncio
async def test_a_line_with_no_reversal_before_it_has_no_history() -> None:
    out = await to_place_service(one_line()).read(YEAR)
    assert out.groups[0].lines[0].reposted_after == []


@pytest.mark.asyncio
async def test_a_no_request_line_says_why_nothing_was_found() -> None:
    store = one_line()
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)  # nobody applied
    seed_line(store, 9003, "300", household=1000009, person=1000091, posted=MAR8)  # a camper who did not apply
    seed_request(store, "reqwithdrawn001", household=1000009, person=1000092, status="withdrawn")
    seed_line(store, 9004, "250", household=1000009, person=1000092, posted=MAR8)
    out = await to_place_service(store).read(YEAR)
    lines = {ln.transaction_cm_id: ln for g in out.groups for ln in g.lines}
    assert lines[9001].no_request is None  # it has a candidate
    assert [(lines[t].no_request.kind, lines[t].no_request.person) for t in (9002, 9003, 9004)] == [  # type: ignore[union-attr]
        ("household_no_application", ""),
        ("person_no_application", "Camper 1000091"),
        ("withdrawn", "Camper 1000092"),
    ]
