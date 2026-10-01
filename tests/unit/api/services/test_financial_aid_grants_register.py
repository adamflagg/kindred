"""The grants register core (sub-project 6-core): pure functions, fictional data only."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from api.services.financial_aid_grants_register import (
    Commitment,
    Enrollment,
    ExpectedGrant,
    FormAnswer,
    GrantLine,
    Placement,
    RegisterInputs,
    RequestRef,
    RequestShare,
    build_register,
    expected_grants,
    grant_inputs_by_request,
    needs_attention,
    outside_grants_by_request,
    program_family_for_session_type,
    split_equally,
)

GRANT = "regional grant - north"
OTHER = "city grant"  # a description that names no grantor yet
CITY = "city fund award"  # a description mapped to another grantor
EMMA, LIAM = 1001, 1002  # siblings in household 100
S1, S2, S3 = 1000101, 1000102, 1000103  # summer sessions
HOUSEHOLD = 100
GRANTORS = {GRANT: "regional_fund", OTHER: "", CITY: "city_fund"}


def _line(txn: int = 9001, amount: str = "500", **kw: Any) -> GrantLine:
    base: dict[str, Any] = {
        "transaction_cm_id": txn,
        "household_cm_id": HOUSEHOLD,
        "person_cm_id": 0,
        "amount": Decimal(amount),
        "source_key": GRANT,
        "source_family": "other_outside",
        "funder_type": "outside",
        "post_date": "2031-02-10 17:00:00.000Z",
        "is_reversed": False,
        "reversal_date": "",
        "attribution_method": "household_single_camper",
        "attributed_person_cm_id": EMMA,
        "attributed_session_cm_id": S1,
        "program_family": "summer",
    }
    base.update(kw)
    return GrantLine(**base)


def _commitment(cid: str = "com000000000001", amount: str = "500", **kw: Any) -> Commitment:
    base: dict[str, Any] = {
        "id": cid,
        "grantor_key": "regional_fund",
        "household_cm_id": HOUSEHOLD,
        "person_cm_id": EMMA,
        "session_cm_id": 0,
        "program_family": "",
        "amount": Decimal(amount),
        "committed_on": date(2031, 1, 20),
        "created": datetime(2031, 1, 21, 18, 0, tzinfo=UTC),
        "status": "open",
    }
    base.update(kw)
    return Commitment(**base)


ENROLLED = (
    Enrollment(EMMA, S1, "summer", 2),
    Enrollment(EMMA, S2, "summer", 2),
    Enrollment(LIAM, S1, "summer", 2),
)
REQUESTS = (
    RequestRef("req-emma-1", HOUSEHOLD, EMMA, S1, "active"),
    RequestRef("req-emma-2", HOUSEHOLD, EMMA, S2, "active"),
    RequestRef("req-liam-1", HOUSEHOLD, LIAM, S1, "active"),
)


def _inputs(**kw: Any) -> RegisterInputs:
    base: dict[str, Any] = {
        "lines": (),
        "placements": {},
        "commitments": (),
        "grantor_by_source": GRANTORS,
        "enrollments": ENROLLED,
        "requests": REQUESTS,
    }
    base.update(kw)
    return RegisterInputs(**base)


def _one(rows: list[Any], **match: Any) -> Any:
    found = [r for r in rows if all(getattr(r, k) == v for k, v in match.items())]
    assert len(found) == 1, (match, rows)
    return found[0]


# --- campers --------------------------------------------------------------------------


def test_an_inferred_camper_is_a_suggestion_and_counts_toward_nothing() -> None:
    """Review Focus 2 / Decision 3: Go's household_single_camper is an inference, not a camper."""
    rows = build_register(_inputs(lines=(_line(),)))
    row = _one(rows, transaction_cm_id=9001)
    assert (row.person_cm_id, row.camper_basis, row.counts, row.requests) == (0, "none", False, ())
    assert grant_inputs_by_request(rows) == {}


def test_a_line_posted_to_an_enrolled_person_names_its_camper() -> None:
    line = _line(person_cm_id=EMMA, attribution_method="posted_person_single_enrollment")
    row = _one(build_register(_inputs(lines=(line,))), transaction_cm_id=9001)
    assert (row.person_cm_id, row.camper_basis, row.session_cm_id, row.counts) == (EMMA, "ledger", S1, True)


def test_a_line_posted_to_a_parent_is_still_household_level() -> None:
    parent = 1090  # no enrollment this season
    row = _one(build_register(_inputs(lines=(_line(person_cm_id=parent),))), transaction_cm_id=9001)
    assert (row.person_cm_id, row.camper_basis) == (0, "none")


def test_a_placement_confirms_the_camper_and_outranks_the_ledger() -> None:
    line = _line(person_cm_id=EMMA)
    rows = build_register(_inputs(lines=(line,), placements={9001: Placement(9001, LIAM, S1, "summer")}))
    row = _one(rows, transaction_cm_id=9001)
    assert (row.person_cm_id, row.camper_basis, row.session_cm_id) == (LIAM, "placed", S1)
    assert row.requests == (RequestShare("req-liam-1", Decimal(500)),)


def test_a_reversed_line_stays_one_row_and_counts_toward_nothing() -> None:
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="2031-03-01 17:00:00.000Z")
    row = _one(build_register(_inputs(lines=(line,))), transaction_cm_id=9001)
    assert (row.is_reversed, row.counts, row.requests) == (True, False, ())


def test_the_grantor_comes_from_the_descriptions_mapping() -> None:
    rows = build_register(_inputs(lines=(_line(), _line(9002, source_key=OTHER))))
    assert _one(rows, transaction_cm_id=9001).grantor_key == "regional_fund"
    assert _one(rows, transaction_cm_id=9002).grantor_key == ""


# --- commitments ----------------------------------------------------------------------


def test_an_open_commitment_counts_until_its_line_arrives() -> None:
    rows = build_register(_inputs(commitments=(_commitment(session_cm_id=S1),)))
    row = _one(rows, kind="commitment")
    assert (row.person_cm_id, row.camper_basis, row.counts, row.recorded_on) == (EMMA, "commitment", True, "2031-01-20")
    assert row.requests == (RequestShare("req-emma-1", Decimal(500)),)


def test_a_line_naming_the_camper_fulfils_the_commitment_and_only_the_line_counts() -> None:
    """Review Focus 1: never both. CampMinder's amount wins (Decision 4)."""
    line = _line(amount="450", person_cm_id=EMMA)
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))
    assert [r.kind for r in rows] == ["ledger"]
    row = rows[0]
    assert (row.counts, row.amount, row.fulfils_commitment_id) == (True, Decimal(450), "com000000000001")


def test_a_fulfilled_commitment_keeps_its_earlier_recorded_at() -> None:
    """Decision 5: a grant known (hand-entered) before the offer isn't made late by its posting."""
    line = _line(person_cm_id=EMMA, post_date="2031-03-15 17:00:00.000Z")
    row = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))[0]
    assert row.recorded_at == datetime(2031, 1, 21, 18, 0, tzinfo=UTC)


def test_a_household_level_line_does_not_fulfil_a_commitment_until_placed() -> None:
    rows = build_register(_inputs(lines=(_line(),), commitments=(_commitment(),)))
    assert _one(rows, kind="commitment").counts is True
    assert _one(rows, kind="ledger").counts is False
    placed = build_register(
        _inputs(lines=(_line(),), commitments=(_commitment(),), placements={9001: Placement(9001, EMMA, 0, "")})
    )
    assert [r.kind for r in placed] == ["ledger"]
    assert placed[0].fulfils_commitment_id == "com000000000001"


def test_a_line_from_another_grantor_does_not_fulfil_a_commitment() -> None:
    line = _line(person_cm_id=EMMA, source_key=CITY)
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))
    assert {r.kind for r in rows} == {"ledger", "commitment"}


def test_an_unmapped_line_never_fulfils_and_the_commitment_waits_as_a_possible_match() -> None:
    """Owner ruling 2026-09-29 (item B): pairing a line whose description names no grantor with a
    commitment is an inference (D16), so it is never decided silently. Both count until finance
    maps the description -- a double count that shows twice: in Unmapped, and in Waiting with the
    line as evidence."""
    line = _line(person_cm_id=EMMA, source_key=OTHER)
    inputs = _inputs(lines=(line,), commitments=(_commitment(),))
    rows = build_register(inputs)
    assert {r.kind: r.counts for r in rows} == {"ledger": True, "commitment": True}
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    attention = needs_attention(rows, inputs, candidates={}, today=TODAY)
    (waiting,) = attention.waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("possible_match", 9001)
    assert [u.source_key for u in attention.unmapped] == [OTHER]


def test_only_the_same_grantor_line_fulfils() -> None:
    lines = (_line(9001, person_cm_id=EMMA, source_key=OTHER), _line(9002, person_cm_id=EMMA))
    rows = build_register(_inputs(lines=lines, commitments=(_commitment(),)))
    assert {r.transaction_cm_id: r.fulfils_commitment_id for r in rows} == {9001: "", 9002: "com000000000001"}


def test_at_go_live_another_grantors_unmapped_line_does_not_swallow_a_commitment() -> None:
    """Every description is unmapped until the grantor bootstrap runs. A camper's $1,000 grant from
    one source must not "fulfil" a $500 commitment from another, which would silently drop the $500."""
    unmapped = {GRANT: "", OTHER: "", CITY: ""}
    line = _line(amount="1000", person_cm_id=EMMA, source_key=CITY)
    commitment = _commitment(grantor_key="synagogue_fund")
    rows = build_register(_inputs(lines=(line,), commitments=(commitment,), grantor_by_source=unmapped))
    total = sum((g.amount for gs in grant_inputs_by_request(rows).values() for g in gs), Decimal(0))
    assert total == Decimal(1500)


def test_an_unmapped_incentive_line_never_fulfils_an_outside_commitment() -> None:
    """FIX: only an outside-funded line is a fulfilment candidate. An unmapped INCENTIVE (JFAM)
    line posted to the same camper must not swallow the outside commitment -- that would stop the
    commitment counting and drop the grant from grant_inputs_by_request entirely."""
    incentive = _line(9002, "400", person_cm_id=EMMA, source_key=OTHER, funder_type="incentive")
    rows = build_register(_inputs(lines=(incentive,), commitments=(_commitment(session_cm_id=S1),)))
    assert {r.kind for r in rows} == {"ledger", "commitment"}
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    commitment_row = _one(rows, kind="commitment")
    assert commitment_row.counts is True
    assert commitment_row.requests == (RequestShare("req-emma-1", Decimal(500)),)
    inputs = grant_inputs_by_request(rows)
    (grant,) = inputs["req-emma-1"]
    assert (grant.amount, grant.state) == (Decimal(500), "committed")


def test_a_reversed_line_never_closes_a_commitment() -> None:
    """Controller ruling (fix round 2, item 3 -- supersedes the earlier "a reversed line can still
    close it" rule): CampMinder corrects a posting by reversing it and reposting a fresh line, so a
    reversed line is never a fulfilment candidate -- only a live line is. The reversed line still
    counts toward nothing itself, and the commitment it would have closed stays open and keeps
    counting."""
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="2031-04-01 17:00:00.000Z")
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))
    assert {r.kind for r in rows} == {"ledger", "commitment"}
    ledger_row = _one(rows, kind="ledger")
    assert (ledger_row.counts, ledger_row.fulfils_commitment_id) == (False, "")
    assert _one(rows, kind="commitment").counts is True


def test_a_commitment_whose_line_was_reversed_waits_as_posted_then_reversed() -> None:
    """Owner ruling 2026-09-29 (item A): Ruling 2 stands, and the revived commitment says why it is
    back -- a grant posted, then pulled, is not "still not in CampMinder" -- so staff know to
    withdraw it."""
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="2031-02-20 17:00:00.000Z")
    (waiting,) = _attention(lines=(line,), commitments=(_commitment(),)).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("posted_then_reversed", 9001)


def test_a_commitment_with_no_created_time_waits_as_not_posted() -> None:
    """A reversal can only be placed after a commitment whose own time is known."""
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="2031-02-20 17:00:00.000Z")
    (waiting,) = _attention(lines=(line,), commitments=(_commitment(created=None),)).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("not_posted", 0)


def test_a_reversal_before_the_commitment_was_entered_does_not_swallow_it() -> None:
    """A reversal that predates the commitment is unrelated to it: the commitment is for a new grant
    not yet posted. It keeps counting and waits as not posted."""
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="2031-02-12 17:00:00.000Z")
    commitment = _commitment(
        session_cm_id=S1, committed_on=date(2031, 3, 1), created=datetime(2031, 3, 2, 12, 0, tzinfo=UTC)
    )
    rows = build_register(_inputs(lines=(line,), commitments=(commitment,)))
    assert {r.kind for r in rows} == {"ledger", "commitment"}
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    commitment_row = _one(rows, kind="commitment")
    assert commitment_row.counts is True
    assert commitment_row.requests == (RequestShare("req-emma-1", Decimal(500)),)
    inputs = grant_inputs_by_request(rows)
    (grant,) = inputs["req-emma-1"]
    assert (grant.amount, grant.state, grant.recorded_at) == (Decimal(500), "committed", commitment.created)
    (waiting,) = _attention(lines=(line,), commitments=(commitment,)).waiting
    assert waiting.reason == "not_posted"


def test_a_same_grantor_line_on_a_sibling_is_a_possible_match() -> None:
    """A commitment on Liam and a same-grantor line named on Emma: both count (it may be two
    grants), and Waiting names the sibling's line so staff can tell."""
    line = _line(person_cm_id=EMMA)
    (waiting,) = _attention(lines=(line,), commitments=(_commitment(person_cm_id=LIAM),)).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("possible_match", 9001)


def test_a_line_posted_before_the_commitment_was_committed_never_fulfils_it() -> None:
    """Owner ruling 2026-09-29 (item D6): a commitment is for a grant not yet posted (D55), so a line
    posted before its committed_on is a different grant. Emma's earlier $500 line must not absorb a
    second $300 grant from the same grantor; both count, and Waiting names the earlier line."""
    line = _line(amount="500", person_cm_id=EMMA, post_date="2031-02-10 17:00:00.000Z")
    commitment = _commitment(amount="300", committed_on=date(2031, 3, 1))
    rows = build_register(_inputs(lines=(line,), commitments=(commitment,)))
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    total = sum((g.amount for gs in grant_inputs_by_request(rows).values() for g in gs), Decimal(0))
    assert total == Decimal(800)
    (waiting,) = _attention(lines=(line,), commitments=(commitment,)).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("possible_match", 9001)


def test_a_later_line_never_takes_a_commitment_from_an_earlier_one() -> None:
    """Owner ruling 2026-09-29 (item D1): the earliest post ranks before an equal amount, so a line
    arriving later can't re-pair the commitment and flip which grant was known before the offer."""
    commitment = _commitment(amount="500")
    early = _line(9001, "450", person_cm_id=EMMA, post_date="2031-03-15 17:00:00.000Z")
    late = _line(9002, "500", person_cm_id=EMMA, post_date="2031-03-20 17:00:00.000Z")
    rows = build_register(_inputs(lines=(early, late), commitments=(commitment,)))
    assert {r.transaction_cm_id: r.fulfils_commitment_id for r in rows} == {9001: "com000000000001", 9002: ""}
    assert _one(rows, transaction_cm_id=9001).recorded_at == commitment.created
    assert _one(rows, transaction_cm_id=9002).recorded_at == datetime(2031, 3, 20, 17, 0, tzinfo=UTC)


def test_a_line_in_another_session_never_fulfils_a_session_commitment() -> None:
    line = _line(person_cm_id=0)
    commitment = _commitment(session_cm_id=S1)
    rows = build_register(
        _inputs(lines=(line,), commitments=(commitment,), placements={9001: Placement(9001, EMMA, S2, "summer")})
    )
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""


def test_the_same_session_line_fulfils_first() -> None:
    """Owner ruling 2026-09-29 (item D2): an S2 line pairs with the S2 commitment even when the S1
    commitment is older, so each request carries its own grant and Waiting names the right one."""
    older_s1 = _commitment("com-s1", session_cm_id=S1)
    newer_s2 = _commitment("com-s2", session_cm_id=S2, created=datetime(2031, 1, 22, 18, 0, tzinfo=UTC))
    line = _line(person_cm_id=0)
    rows = build_register(
        _inputs(
            lines=(line,),
            commitments=(older_s1, newer_s2),
            placements={9001: Placement(9001, EMMA, S2, "summer")},
        )
    )
    assert _one(rows, kind="ledger").fulfils_commitment_id == "com-s2"
    assert _one(rows, kind="commitment").commitment_id == "com-s1"
    shares = {k: sum((g.amount for g in v), Decimal(0)) for k, v in grant_inputs_by_request(rows).items()}
    assert shares == {"req-emma-1": Decimal(500), "req-emma-2": Decimal(500)}


def test_a_fulfilling_line_without_a_session_takes_the_commitments_session() -> None:
    line = _line(person_cm_id=EMMA, attributed_session_cm_id=0)
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(session_cm_id=S1),)))
    row = _one(rows, kind="ledger")
    assert (row.session_cm_id, row.requests) == (S1, (RequestShare("req-emma-1", Decimal(500)),))


def test_two_commitments_pair_one_to_one_preferring_the_equal_amount() -> None:
    lines = (_line(9001, "300", person_cm_id=EMMA), _line(9002, "500", person_cm_id=EMMA))
    commitments = (_commitment("com-a", "500"), _commitment("com-b", "300"))
    rows = build_register(_inputs(lines=lines, commitments=commitments))
    assert {r.transaction_cm_id: r.fulfils_commitment_id for r in rows} == {9001: "com-b", 9002: "com-a"}


def test_a_commitment_on_a_cancelled_camper_stops_counting_and_waits_as_camper_cancelled() -> None:
    """Owner ruling 2026-09-29 (item D5): cancelled is derived from enrollment, a rule rather than an
    inference, so the commitment stops counting while every enrollment it covers is cancelled --
    as CampMinder reverses a posted grant -- and waits for staff to withdraw it."""
    cancelled = (Enrollment(EMMA, S1, "summer", 32), Enrollment(EMMA, S2, "summer", 32))
    rows = build_register(_inputs(commitments=(_commitment(),), enrollments=cancelled))
    row = _one(rows, kind="commitment")
    assert (row.cancelled, row.counts, row.requests) == (True, False, ())
    assert grant_inputs_by_request(rows) == {}
    (waiting,) = _attention(commitments=(_commitment(),), enrollments=cancelled).waiting
    assert waiting.reason == "camper_cancelled"


def test_a_commitment_counts_while_the_camper_still_has_an_active_session() -> None:
    partly = (Enrollment(EMMA, S1, "summer", 32), Enrollment(EMMA, S2, "summer", 2))
    row = _one(build_register(_inputs(commitments=(_commitment(),), enrollments=partly)), kind="commitment")
    assert (row.cancelled, row.counts) == (False, True)


def test_a_withdrawn_commitment_is_not_in_the_register() -> None:
    assert build_register(_inputs(commitments=(_commitment(status="withdrawn"),))) == []


def test_a_reverse_and_repost_leaves_the_second_commitment_counting() -> None:
    """The real bug (item 3): CampMinder corrects a posting by reversing it and reposting a fresh
    line. With two same-grantor $500 commitments on one camper, the old rule let the live repost
    fulfil one commitment while the reversed original ALSO closed the other, so only $500 counted
    where $1,000 should. Only a live line is a fulfilment candidate now: line A is posted then
    reversed, line B is the live repost -- exactly one commitment is fulfilled (by B), the other
    keeps counting, and the two requests together see the full $1,000."""
    line_a = _line(9001, "500", person_cm_id=EMMA, is_reversed=True, reversal_date="2031-02-15 17:00:00.000Z")
    line_b = _line(9002, "500", person_cm_id=EMMA, post_date="2031-02-15 18:00:00.000Z")
    commitments = (_commitment("com-a", "500", session_cm_id=S1), _commitment("com-b", "500", session_cm_id=S2))
    rows = build_register(_inputs(lines=(line_a, line_b), commitments=commitments))
    fulfilled = {r.transaction_cm_id: r.fulfils_commitment_id for r in rows if r.kind == "ledger"}
    assert fulfilled == {9001: "", 9002: "com-a"}
    remaining = _one(rows, kind="commitment")
    assert (remaining.commitment_id, remaining.counts) == ("com-b", True)
    inputs = grant_inputs_by_request(rows)
    total = sum((g.amount for r in ("req-emma-1", "req-emma-2") for g in inputs.get(r, ())), Decimal(0))
    assert total == Decimal(1000)


# --- requests and the split -------------------------------------------------------------


def test_split_equally_gives_the_remainder_cent_to_the_first() -> None:
    assert split_equally(Decimal(1000), ["a", "b"]) == (
        RequestShare("a", Decimal("500.00")),
        RequestShare("b", Decimal("500.00")),
    )
    assert [s.amount for s in split_equally(Decimal(1000), ["a", "b", "c"])] == [
        Decimal("333.34"),
        Decimal("333.33"),
        Decimal("333.33"),
    ]
    assert split_equally(Decimal(1000), []) == ()


def test_a_grant_with_no_session_splits_equally_across_the_campers_requests_in_its_family() -> None:
    """Review Focus 5; main spec §2 item 18."""
    rows = build_register(_inputs(lines=(_line(amount="1000"),), placements={9001: Placement(9001, EMMA, 0, "summer")}))
    assert _one(rows, transaction_cm_id=9001).requests == (
        RequestShare("req-emma-1", Decimal("500.00")),
        RequestShare("req-emma-2", Decimal("500.00")),
    )


def test_a_grant_with_a_session_sits_on_that_request_only() -> None:
    rows = build_register(
        _inputs(lines=(_line(amount="1000"),), placements={9001: Placement(9001, EMMA, S2, "summer")})
    )
    assert _one(rows, transaction_cm_id=9001).requests == (RequestShare("req-emma-2", Decimal(1000)),)


def test_a_camper_who_never_applied_has_no_requests_behind_the_grant() -> None:
    """D55: 63% of grant households never applied; the register says "didn't apply" (an empty list)."""
    nonapplicant = 1003
    enrolled = (*ENROLLED, Enrollment(nonapplicant, S3, "summer", 2))
    line = _line(person_cm_id=nonapplicant, attributed_person_cm_id=nonapplicant, attributed_session_cm_id=S3)
    row = _one(build_register(_inputs(lines=(line,), enrollments=enrolled)), transaction_cm_id=9001)
    assert (row.counts, row.requests) == (True, ())


def test_a_withdrawn_request_takes_no_share() -> None:
    requests = (RequestRef("req-emma-1", HOUSEHOLD, EMMA, S1, "withdrawn"), REQUESTS[1])
    rows = build_register(
        _inputs(lines=(_line(amount="1000"),), placements={9001: Placement(9001, EMMA, 0, "summer")}, requests=requests)
    )
    assert _one(rows, transaction_cm_id=9001).requests == (RequestShare("req-emma-2", Decimal("1000.00")),)


def test_an_unmatched_request_with_no_session_takes_no_share() -> None:
    """Ruling (item 4): split only across requests with a resolved session (session_cm_id > 0); a
    request name resolution never matched to a session (session_cm_id 0) takes no share, even when
    the grant itself has no session and no family to narrow by."""
    requests = (
        RequestRef("req-emma-1", HOUSEHOLD, EMMA, S1, "active"),
        RequestRef("req-emma-unmatched", HOUSEHOLD, EMMA, 0, "active"),
    )
    rows = build_register(
        _inputs(lines=(_line(amount="1000"),), placements={9001: Placement(9001, EMMA, 0, "")}, requests=requests)
    )
    assert _one(rows, transaction_cm_id=9001).requests == (RequestShare("req-emma-1", Decimal("1000.00")),)


# --- cancelled (derived from enrollment) ---------------------------------------------------


def test_a_grant_is_cancelled_when_its_campers_enrollment_is_cancelled() -> None:
    enrolled = (Enrollment(EMMA, S1, "summer", 32), Enrollment(EMMA, S2, "summer", 2))
    rows = build_register(
        _inputs(lines=(_line(),), placements={9001: Placement(9001, EMMA, S1, "summer")}, enrollments=enrolled)
    )
    assert _one(rows, transaction_cm_id=9001).cancelled is True
    rows = build_register(
        _inputs(lines=(_line(),), placements={9001: Placement(9001, EMMA, 0, "summer")}, enrollments=enrolled)
    )
    assert _one(rows, transaction_cm_id=9001).cancelled is False  # still enrolled in the family


# --- the target follows the program: Family Camp is household-level ------------------------

FC1, FC2 = 1000301, 1000302  # Family Camp weekends
FC_ENROLLED = (*ENROLLED, Enrollment(1050, FC1, "family_camp", 2), Enrollment(1050, FC2, "family_camp", 2))
FC_REQUESTS = (
    *REQUESTS,
    RequestRef("req-fc-1", HOUSEHOLD, 0, FC1, "active"),
    RequestRef("req-fc-2", HOUSEHOLD, 0, FC2, "active"),
)


def _fc_line(txn: int = 9101, amount: str = "300", **kw: Any) -> GrantLine:
    base: dict[str, Any] = {
        "attribution_method": "program_family",
        "attributed_person_cm_id": 0,
        "attributed_session_cm_id": 0,
        "program_family": "family_camp",
    }
    base.update(kw)
    return _line(txn, amount, **base)


def test_a_family_camp_line_needs_no_camper_and_lands_on_the_households_request() -> None:
    """Owner ruling 2026-09-29: the target follows the program. Family Camp aid requests are the
    household's (person 0), so a Family Camp grant counts once live and sits on that request; it
    never waits for a camper."""
    inputs = _inputs(lines=(_fc_line(attributed_session_cm_id=FC1),), enrollments=FC_ENROLLED, requests=FC_REQUESTS)
    rows = build_register(inputs)
    row = _one(rows, transaction_cm_id=9101)
    assert (row.person_cm_id, row.camper_basis, row.counts) == (0, "household", True)
    assert (row.session_cm_id, row.requests) == (FC1, (RequestShare("req-fc-1", Decimal(300)),))
    assert needs_attention(rows, inputs, candidates={}, today=TODAY).needs_camper == ()


def test_a_family_camp_line_with_no_session_splits_across_the_households_family_camp_requests() -> None:
    rows = build_register(_inputs(lines=(_fc_line(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS))
    assert _one(rows, transaction_cm_id=9101).requests == (
        RequestShare("req-fc-1", Decimal("150.00")),
        RequestShare("req-fc-2", Decimal("150.00")),
    )


def test_a_family_camp_line_placed_on_a_person_still_lands_on_the_households_request() -> None:
    placements = {9101: Placement(9101, 1050, FC2, "family_camp")}
    rows = build_register(
        _inputs(lines=(_fc_line(),), placements=placements, enrollments=FC_ENROLLED, requests=FC_REQUESTS)
    )
    row = _one(rows, transaction_cm_id=9101)
    assert (row.person_cm_id, row.counts, row.requests) == (1050, True, (RequestShare("req-fc-2", Decimal(300)),))


def _fc_commitment(**kw: Any) -> Commitment:
    return _commitment("com-fc", person_cm_id=1050, program_family="family_camp", **kw)


def test_a_family_camp_commitment_sits_on_the_households_request() -> None:
    """The target follows the program for a commitment too: its camper names the family, but the
    Family Camp request it offsets is the household's."""
    rows = build_register(_inputs(commitments=(_fc_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS))
    assert _one(rows, kind="commitment").requests == (
        RequestShare("req-fc-1", Decimal("250.00")),
        RequestShare("req-fc-2", Decimal("250.00")),
    )


def test_a_household_level_family_camp_line_fulfils_the_households_family_camp_commitment() -> None:
    """A Family Camp line needs no camper, so it pairs with a Family Camp commitment in the same
    household by every other rule (grantor, session, date), never both counting."""
    rows = build_register(
        _inputs(lines=(_fc_line(),), commitments=(_fc_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS)
    )
    assert [r.kind for r in rows] == ["ledger"]
    assert rows[0].fulfils_commitment_id == "com-fc"


def test_a_family_camp_line_in_another_session_never_fulfils_the_households_commitment() -> None:
    """Item D2 for a household program: the line's session is Go's attribution (the session it sits
    on), so a line for the second weekend never closes a commitment for the first."""
    rows = build_register(
        _inputs(
            lines=(_fc_line(attributed_session_cm_id=FC2),),
            commitments=(_fc_commitment(session_cm_id=FC1),),
            enrollments=FC_ENROLLED,
            requests=FC_REQUESTS,
        )
    )
    assert _one(rows, kind="ledger").requests == (RequestShare("req-fc-2", Decimal(300)),)
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    assert _one(rows, kind="commitment").requests == (RequestShare("req-fc-1", Decimal(500)),)


def test_a_family_camp_line_never_fulfils_a_summer_commitment_in_the_household() -> None:
    rows = build_register(
        _inputs(lines=(_fc_line(),), commitments=(_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS)
    )
    assert {r.kind for r in rows} == {"ledger", "commitment"}


def test_a_family_camp_incentive_counts_but_never_reaches_the_bridge() -> None:
    line = _fc_line(funder_type="incentive", source_family="jfam_incentive", attributed_session_cm_id=FC1)
    rows = build_register(_inputs(lines=(line,), enrollments=FC_ENROLLED, requests=FC_REQUESTS))
    assert _one(rows, transaction_cm_id=9101).counts is True
    assert grant_inputs_by_request(rows) == {}


# --- the calculator bridge ---------------------------------------------------------------


def test_grant_inputs_by_request_carries_only_counting_outside_grants() -> None:
    incentive = _line(9002, "200", funder_type="incentive", source_family="jfam_incentive")
    lines = (_line(9001, "1000", person_cm_id=EMMA, attributed_session_cm_id=0, program_family="summer"), incentive)
    rows = build_register(_inputs(lines=lines, placements={9002: Placement(9002, EMMA, S1, "summer")}))
    inputs = grant_inputs_by_request(rows)
    assert sorted(inputs) == ["req-emma-1", "req-emma-2"]
    (grant,) = inputs["req-emma-1"]
    assert (grant.amount, grant.state) == (Decimal("500.00"), "committed")
    assert grant.recorded_at == datetime(2031, 2, 10, 17, 0, tzinfo=UTC)


LAST_DOLLAR = "last dollar award"  # a description mapped to a grantor that pays after the camp's award
LAST_DOLLAR_FUND = "last_dollar_fund"


def _last_dollar_register() -> list[Any]:
    """Emma: an ordinary outside grant and a pays-after line posted at the full session price;
    Liam: an open commitment from the pays-after grantor."""
    lines = (
        _line(9001, "500", person_cm_id=EMMA),
        _line(9002, "2000", person_cm_id=EMMA, source_key=LAST_DOLLAR),
    )
    commitment = _commitment(grantor_key=LAST_DOLLAR_FUND, person_cm_id=LIAM, session_cm_id=S1, amount="1800")
    return build_register(
        _inputs(
            lines=lines,
            commitments=(commitment,),
            grantor_by_source={**GRANTORS, LAST_DOLLAR: LAST_DOLLAR_FUND},
            pays_after_grantors=frozenset({LAST_DOLLAR_FUND}),
        )
    )


def test_a_pays_after_camp_aid_grant_never_reaches_the_bridge() -> None:
    """D143: a last-dollar funder pays whatever the camp's award leaves, so neither its ledger line (posted
    at the full price first) nor its commitment may lower the award. The ordinary grant still does."""
    inputs = grant_inputs_by_request(_last_dollar_register())
    assert sorted(inputs) == ["req-emma-1"]
    (grant,) = inputs["req-emma-1"]
    assert grant.amount == Decimal(500)


def test_the_register_still_lists_and_counts_a_pays_after_camp_aid_grant() -> None:
    """Only the calculator bridge leaves it out: the register, its money totals and development's
    all-money figures keep it, on the camper's request."""
    rows = _last_dollar_register()
    line = _one(rows, transaction_cm_id=9002)
    assert (line.grantor_key, line.pays_after_camp_aid, line.counts) == (LAST_DOLLAR_FUND, True, True)
    assert line.requests == (RequestShare("req-emma-1", Decimal(2000)),)
    commitment = _one(rows, kind="commitment")
    assert (commitment.pays_after_camp_aid, commitment.counts) == (True, True)
    assert commitment.requests == (RequestShare("req-liam-1", Decimal(1800)),)
    assert _one(rows, transaction_cm_id=9001).pays_after_camp_aid is False


def test_outside_grants_by_request_keeps_pays_after_camp_aid_grants() -> None:
    """The budget's below-the-line outside grants are money totals, not calculator inputs (D125:
    a last-dollar funder is outside money, outside the budget), so the pays-after grants stay in them."""
    assert outside_grants_by_request(_last_dollar_register()) == {
        "req-emma-1": Decimal(2500),
        "req-liam-1": Decimal(1800),
    }


def test_program_family_for_session_type_mirrors_the_go_map() -> None:
    assert program_family_for_session_type("main") == "summer"
    assert program_family_for_session_type(" Quest ") == "quest"
    assert program_family_for_session_type("tli") == "teen"
    assert program_family_for_session_type("family") == "family_camp"
    assert program_family_for_session_type("adult") == "adult_weekend"
    assert program_family_for_session_type("something new") == "other"


def test_the_python_twin_matches_every_entry_in_the_go_map() -> None:
    """Drift guard: every key in Go's sessionTypeProgramFamily literal maps the same way here."""
    import re
    from pathlib import Path

    from api.services.financial_aid_grants_register import PROGRAM_FAMILY_BY_SESSION_TYPE

    go = (Path(__file__).parents[4] / "pocketbase/sync/aid_program_family.go").read_text()
    constants = dict(
        re.findall(
            r'(sessionType\w+)\s*=\s*"([a-z_]+)"',
            (Path(__file__).parents[4] / "pocketbase/sync/sessions.go").read_text(),
        )
    )
    families = dict(re.findall(r'(programFamily\w+)\s*=\s*"([a-z_]+)"', go))
    body = go.split("var sessionTypeProgramFamily = map[string]string{", 1)[1].split("}", 1)[0]
    pairs = re.findall(r'^\s*("?[\w]+"?):\s*(programFamily\w+),', body, re.MULTILINE)
    entries = [ln for ln in body.splitlines() if ln.strip() and not ln.strip().startswith("//")]
    assert len(pairs) == len(entries), "an entry the pattern can't parse would be skipped silently"
    go_map = {constants.get(k, k.strip('"')): families[v] for k, v in pairs}
    assert go_map == dict(PROGRAM_FAMILY_BY_SESSION_TYPE)


# --- needs attention -------------------------------------------------------------------------

TODAY = date(2031, 3, 1)


def _attention(**kw: Any) -> Any:
    inputs = _inputs(**kw)
    return needs_attention(build_register(inputs), inputs, candidates={HOUSEHOLD: (EMMA, LIAM)}, today=TODAY)


def test_a_household_level_line_needs_a_camper_with_gos_suggestion_as_evidence() -> None:
    (need,) = _attention(lines=(_line(),)).needs_camper
    assert need.row.transaction_cm_id == 9001
    assert need.household_applied is True
    assert need.candidates == (EMMA, LIAM)
    s = need.suggestion
    assert s is not None
    assert (s.person_cm_id, s.session_cm_id, s.basis, s.method) == (EMMA, S1, "attribution", "household_single_camper")


def test_a_commitment_on_the_household_is_the_stronger_suggestion() -> None:
    commitment = _commitment(person_cm_id=LIAM, session_cm_id=S1)
    (need,) = _attention(lines=(_line(),), commitments=(commitment,)).needs_camper
    s = need.suggestion
    assert s is not None
    assert (s.person_cm_id, s.basis, s.commitment_id, s.amount_matches) == (LIAM, "commitment", "com000000000001", True)


def test_a_commitment_is_suggested_for_one_line_only() -> None:
    """Owner ruling 2026-09-29 (item D3): offering one commitment as the suggestion for two lines
    lets a single grant be confirmed twice. The second line falls back to Go's attribution."""
    lines = (_line(9001), _line(9002))
    needs = _attention(lines=lines, commitments=(_commitment(person_cm_id=LIAM),)).needs_camper
    by_txn = {n.row.transaction_cm_id: n.suggestion for n in needs}
    first, second = by_txn[9001], by_txn[9002]
    assert first is not None
    assert (first.basis, first.person_cm_id) == ("commitment", LIAM)
    assert second is not None
    assert (second.basis, second.person_cm_id) == ("attribution", EMMA)


def test_a_family_camp_commitment_is_never_suggested_for_a_line_needing_a_camper() -> None:
    """A Family Camp commitment pairs only with a household-level Family Camp line, and those never
    need a camper; offering it to a summer line would place that line as Family Camp."""
    needs = _attention(
        lines=(_line(),), commitments=(_fc_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS
    ).needs_camper
    (need,) = needs
    assert need.suggestion is not None
    assert need.suggestion.basis == "attribution"


def test_a_line_posted_before_the_commitment_is_never_its_suggestion() -> None:
    """Item D6: a line posted before committed_on is a different grant, so confirming it would never
    close the commitment. The line falls back to Go's attribution."""
    commitment = _commitment(person_cm_id=LIAM, committed_on=date(2031, 2, 15))
    (need,) = _attention(lines=(_line(),), commitments=(commitment,)).needs_camper
    assert need.suggestion is not None
    assert (need.suggestion.basis, need.suggestion.person_cm_id) == ("attribution", EMMA)


def test_a_family_camp_commitment_whose_household_line_was_reversed_waits_as_posted_then_reversed() -> None:
    """Item A for a household program: the Family Camp line sits on the household (person 0), so the
    evidence is matched by household, not by the commitment's camper."""
    line = _fc_line(is_reversed=True, reversal_date="2031-02-20 17:00:00.000Z")
    (waiting,) = _attention(
        lines=(line,), commitments=(_fc_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS
    ).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("posted_then_reversed", 9101)


def test_an_unmapped_family_camp_line_is_a_possible_match_for_the_households_commitment() -> None:
    """Item B for a household program: an unmapped household-level Family Camp line never fulfils the
    commitment but is shown beside it, as it would be on the camper for a summer commitment."""
    line = _fc_line(source_key=OTHER)
    (waiting,) = _attention(
        lines=(line,), commitments=(_fc_commitment(),), enrollments=FC_ENROLLED, requests=FC_REQUESTS
    ).waiting
    assert (waiting.reason, waiting.transaction_cm_id) == ("possible_match", 9101)


def test_a_line_with_no_inference_has_candidates_but_no_suggestion() -> None:
    line = _line(attributed_person_cm_id=0, attributed_session_cm_id=0, attribution_method="ambiguous")
    (need,) = _attention(lines=(line,)).needs_camper
    assert need.suggestion is None
    assert need.candidates == (EMMA, LIAM)


def test_needs_a_camper_lists_applicant_households_only_the_largest_amount_first() -> None:
    """D126: a household that never applied is not worked in the aid part, so its household-level
    line leaves "needs a camper" (the registrar does no extra tracking for it). It stays in the
    register, at household level."""
    other_household = 150
    lines = (
        _line(9001, "100"),
        _line(9002, "900", household_cm_id=other_household),
        _line(9003, "300"),
    )
    inputs = _inputs(lines=lines)
    rows = build_register(inputs)
    needs = needs_attention(rows, inputs, candidates={HOUSEHOLD: (EMMA, LIAM)}, today=TODAY).needs_camper
    assert [n.row.transaction_cm_id for n in needs] == [9003, 9001]
    assert [n.household_applied for n in needs] == [True, True]
    kept = _one(rows, transaction_cm_id=9002)
    assert (kept.person_cm_id, kept.camper_basis, kept.amount) == (0, "none", Decimal(900))


# --- never-applied households (D126, D142) ------------------------------------------------------

NEVER_APPLIED = 200
OLIVIA, RILEY, PARENT = 2001, 2002, 2003  # a camper, a sibling camper, an adult in household 200
Q1, T1, AW1 = 1000201, 1000301, 1000401  # a Quest, a teen and an adult weekend session


def _never_applied(
    *enrolled: Enrollment, people: frozenset[int] = frozenset({OLIVIA, RILEY, PARENT}), **kw: Any
) -> tuple[Any, Any]:
    """A household-level line in a household with no aid request, whose family of households
    holds `people`."""
    line_kw: dict[str, Any] = {"household_cm_id": NEVER_APPLIED, "attributed_person_cm_id": 0}
    line_kw.update(kw.pop("line", {}))
    inputs = _inputs(
        lines=(_line(9201, **line_kw),),
        enrollments=ENROLLED + enrolled,
        household_people={HOUSEHOLD: frozenset({EMMA, LIAM}), NEVER_APPLIED: people},
        **kw,
    )
    rows = build_register(inputs)
    return _one(rows, transaction_cm_id=9201), needs_attention(rows, inputs, candidates={}, today=TODAY)


def test_a_never_applied_households_grant_ties_itself_to_its_sole_camper() -> None:
    """D142: exactly one camper the grant can pay for this season, so Kindred ties it there -- a
    machine placement ("sole_camper"), not a staff one. The adult's weekend is not a program an
    outside grant pays for (D95), so the adult is not a second candidate."""
    row, attention = _never_applied(Enrollment(OLIVIA, S1, "summer", 2), Enrollment(PARENT, AW1, "adult_weekend", 2))
    assert (row.person_cm_id, row.camper_basis, row.session_cm_id, row.program_family) == (
        OLIVIA,
        "sole_camper",
        S1,
        "summer",
    )
    assert (row.counts, row.requests, row.cancelled) == (True, (), False)
    assert attention.needs_camper == ()


def test_a_sole_camper_in_two_sessions_is_tied_without_a_session() -> None:
    # Two sessions leave no single session; the default line is a summer line, so the program is its own
    # (owner ruling 2026-09-29, as for a staff placement).
    row, _ = _never_applied(Enrollment(OLIVIA, S1, "summer", 2), Enrollment(OLIVIA, Q1, "quest", 2))
    assert (row.person_cm_id, row.camper_basis, row.session_cm_id, row.program_family) == (
        OLIVIA,
        "sole_camper",
        0,
        "summer",
    )


def test_a_sole_camper_in_two_programs_takes_the_lines_own_program_when_active_in_it() -> None:
    """Owner ruling 2026-09-29, applied to D142's automatic tie as it already applies to a staff
    placement: a camper active in two programs names no single family, so the line's own program
    wins when the camper is actively enrolled in it."""
    row, _ = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2), Enrollment(OLIVIA, Q1, "quest", 2), line={"program_family": "summer"}
    )
    assert (row.person_cm_id, row.camper_basis, row.session_cm_id, row.program_family) == (
        OLIVIA,
        "sole_camper",
        0,
        "summer",
    )


def test_a_sole_camper_in_two_programs_keeps_no_program_when_the_lines_program_is_not_one_of_them() -> None:
    row, _ = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2), Enrollment(OLIVIA, Q1, "quest", 2), line={"program_family": "teen"}
    )
    assert (row.person_cm_id, row.camper_basis, row.program_family) == (OLIVIA, "sole_camper", "")


def test_a_never_applied_household_with_two_eligible_campers_stays_household_level() -> None:
    """D142: nobody places these by hand, and Kindred never guesses between two campers."""
    row, attention = _never_applied(Enrollment(OLIVIA, S1, "summer", 2), Enrollment(RILEY, Q1, "quest", 2))
    assert (row.person_cm_id, row.camper_basis, row.counts) == (0, "none", False)
    assert attention.needs_camper == ()


def test_a_never_applied_household_with_only_an_adult_weekend_stays_household_level() -> None:
    row, attention = _never_applied(Enrollment(PARENT, AW1, "adult_weekend", 2))
    assert (row.person_cm_id, row.camper_basis) == (0, "none")
    assert attention.needs_camper == ()


def test_a_cancelled_camper_is_not_a_second_candidate() -> None:
    row, _ = _never_applied(Enrollment(OLIVIA, S1, "summer", 2), Enrollment(RILEY, S1, "summer", 32))
    assert (row.person_cm_id, row.camper_basis) == (OLIVIA, "sole_camper")


def test_a_camper_outside_the_household_is_never_tied() -> None:
    """Only people in the grant's family of households are candidates: another household's
    enrolled camper is not this grant's."""
    row, _ = _never_applied(Enrollment(OLIVIA, S1, "summer", 2), people=frozenset({RILEY, PARENT}))
    assert (row.person_cm_id, row.camper_basis) == (0, "none")


def test_the_sources_reporting_group_decides_which_campers_it_can_pay_for() -> None:
    """D100: a source says which programs it funds. A Camp & Quest source can't pay for the teen
    sibling, so the summer camper is the only one it can pay for."""
    row, _ = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2),
        Enrollment(RILEY, T1, "teen", 2),
        families_by_source={GRANT: frozenset({"summer", "quest"})},
    )
    assert (row.person_cm_id, row.camper_basis) == (OLIVIA, "sole_camper")


def test_a_source_that_funds_no_camper_program_is_never_tied_to_a_camper() -> None:
    row, _ = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2),
        families_by_source={GRANT: frozenset({"adult_weekend"})},
        line={"program_family": ""},
    )
    assert (row.person_cm_id, row.camper_basis) == (0, "none")


def test_a_family_that_applied_through_a_linked_household_is_worked_as_an_applicant() -> None:
    """D126 is about FAMILIES that never applied. An aid family spans its linked households
    (aid_household_links, the set the ledger's "requested aid" reads), so a line posted to a
    household whose linked household applied still needs a camper, and is never tied by rule."""
    row, attention = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2),
        family_households={NEVER_APPLIED: frozenset({NEVER_APPLIED, HOUSEHOLD})},
    )
    assert (row.person_cm_id, row.camper_basis, row.counts) == (0, "none", False)
    assert [(n.row.transaction_cm_id, n.household_applied) for n in attention.needs_camper] == [(9201, True)]


def test_a_staff_placement_still_wins_in_a_never_applied_household() -> None:
    row, _ = _never_applied(
        Enrollment(OLIVIA, S1, "summer", 2),
        Enrollment(RILEY, S1, "summer", 2),
        placements={9201: Placement(9201, RILEY, S1, "summer")},
    )
    assert (row.person_cm_id, row.camper_basis) == (RILEY, "placed")


def test_an_applicant_household_with_one_camper_still_waits_for_the_registrar() -> None:
    """D142 is for families who never applied. An applicant's household-level line keeps today's
    path: it needs a camper, and the registrar picks, even when only one camper fits."""
    inputs = _inputs(
        lines=(_line(),),
        enrollments=(Enrollment(EMMA, S1, "summer", 2),),
        household_people={HOUSEHOLD: frozenset({EMMA})},
    )
    rows = build_register(inputs)
    row = _one(rows, transaction_cm_id=9001)
    assert (row.person_cm_id, row.camper_basis, row.counts) == (0, "none", False)
    (need,) = needs_attention(rows, inputs, candidates={HOUSEHOLD: (EMMA,)}, today=TODAY).needs_camper
    assert (need.row.transaction_cm_id, need.household_applied) == (9001, True)


def test_placed_named_and_reversed_lines_never_need_a_camper() -> None:
    lines = (
        _line(9001, person_cm_id=EMMA),
        _line(9002),
        _line(9003, is_reversed=True, reversal_date="2031-02-20 17:00:00.000Z"),
    )
    needs = _attention(lines=lines, placements={9002: Placement(9002, LIAM, S1, "summer")}).needs_camper
    assert needs == ()


def test_unmapped_descriptions_group_their_live_lines() -> None:
    lines = (_line(9001, "200", source_key=OTHER), _line(9002, "300", source_key=OTHER), _line(9003, "50"))
    (unmapped,) = _attention(lines=lines).unmapped
    assert (unmapped.source_key, unmapped.lines, unmapped.amount) == (OTHER, 2, Decimal(500))


def test_an_unfulfilled_commitment_waits_with_its_age() -> None:
    (waiting,) = _attention(commitments=(_commitment(),)).waiting
    assert (waiting.row.commitment_id, waiting.days_waiting) == ("com000000000001", 40)
    assert (waiting.reason, waiting.transaction_cm_id) == ("not_posted", 0)


def test_days_waiting_never_goes_negative_for_a_future_committed_on() -> None:
    """Ruling (item 5): days_waiting is max(0, ...) so a commitment entered with a committed_on
    after today (e.g. a pre-dated pledge) never reports a negative age."""
    (waiting,) = _attention(commitments=(_commitment(committed_on=date(2031, 4, 1)),)).waiting
    assert waiting.days_waiting == 0


def test_a_fulfilled_commitment_no_longer_waits() -> None:
    assert _attention(lines=(_line(person_cm_id=EMMA),), commitments=(_commitment(),)).waiting == ()


# --- Expected (D56) ------------------------------------------------------------------------------

FAMILIES = {"regional_fund": frozenset({"other_outside"}), "happy_fund": frozenset({"one_happy_camper"})}


def test_a_yes_answer_with_no_grant_of_that_kind_is_expected() -> None:
    answers = [FormAnswer(EMMA, HOUSEHOLD, True, False), FormAnswer(LIAM, HOUSEHOLD, True, True)]
    assert expected_grants(answers, [], FAMILIES) == [
        ExpectedGrant(HOUSEHOLD, "one_happy_camper", (EMMA, LIAM)),
        ExpectedGrant(HOUSEHOLD, "synagogue", (LIAM,)),
    ]


def test_expected_clears_itself_when_a_line_of_that_kind_arrives_even_reversed() -> None:
    line = _line(source_family="one_happy_camper", is_reversed=True, reversal_date="2031-04-01 17:00:00.000Z")
    rows = build_register(_inputs(lines=(line,)))
    assert expected_grants([FormAnswer(EMMA, HOUSEHOLD, True, False)], rows, FAMILIES) == []


def test_expected_clears_itself_when_a_commitment_from_a_grantor_of_that_kind_is_entered() -> None:
    rows = build_register(_inputs(commitments=(_commitment(grantor_key="happy_fund"),)))
    assert expected_grants([FormAnswer(EMMA, HOUSEHOLD, True, False)], rows, FAMILIES) == []


def test_expected_is_never_a_grant() -> None:
    """D56: nothing Expected reaches the calculator."""
    rows = build_register(_inputs())
    assert expected_grants([FormAnswer(EMMA, HOUSEHOLD, True, True)], rows, FAMILIES)
    assert grant_inputs_by_request(rows) == {}


def test_an_answer_with_no_household_is_skipped() -> None:
    assert expected_grants([FormAnswer(EMMA, 0, True, True)], [], FAMILIES) == []


def test_a_fulfilled_commitments_line_still_carries_its_own_post_instant() -> None:
    """D16b: To place tests a ledger grant's own CampMinder post date, which recorded_at (the earlier
    commitment's) hides; a line posted after the posting day must still read as posted then."""
    line = _line(person_cm_id=EMMA, post_date="2031-03-15 17:00:00.000Z")
    row = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))[0]
    assert row.posted_at == datetime(2031, 3, 15, 17, 0, tzinfo=UTC)
    assert row.recorded_at == datetime(2031, 1, 21, 18, 0, tzinfo=UTC)  # unchanged (Decision 5)
