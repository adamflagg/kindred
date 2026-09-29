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


def test_a_line_from_an_unmapped_description_fulfils_rather_than_double_counting() -> None:
    """Decision 4: until finance maps the description, the line on the same camper is taken to be
    the commitment, so the two never both offset the award."""
    line = _line(person_cm_id=EMMA, source_key=OTHER)
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))
    assert [r.kind for r in rows] == ["ledger"]
    assert rows[0].fulfils_commitment_id == "com000000000001"


def test_a_same_grantor_line_is_preferred_over_an_unmapped_one() -> None:
    lines = (_line(9001, person_cm_id=EMMA, source_key=OTHER), _line(9002, person_cm_id=EMMA))
    rows = build_register(_inputs(lines=lines, commitments=(_commitment(),)))
    assert {r.transaction_cm_id: r.fulfils_commitment_id for r in rows} == {9001: "", 9002: "com000000000001"}


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


def test_a_reversal_before_the_commitment_was_entered_does_not_swallow_it() -> None:
    """Controller ruling (fix round 1): a reversed line is a fulfilment candidate only when its
    reversal is KNOWN to be at or after the commitment's `created` -- otherwise an earlier,
    unrelated reversal would silently swallow a commitment staff entered later, and the grant
    would count toward nothing."""
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


def test_a_reversed_line_with_no_reversal_date_does_not_close_a_commitment() -> None:
    """A reversed line that can't be placed in time (no reversal_date) can't confidently close a
    commitment either."""
    line = _line(person_cm_id=EMMA, is_reversed=True, reversal_date="")
    rows = build_register(_inputs(lines=(line,), commitments=(_commitment(),)))
    assert {r.kind for r in rows} == {"ledger", "commitment"}
    assert _one(rows, kind="ledger").fulfils_commitment_id == ""
    assert _one(rows, kind="commitment").counts is True


def test_two_commitments_pair_one_to_one_preferring_the_equal_amount() -> None:
    lines = (_line(9001, "300", person_cm_id=EMMA), _line(9002, "500", person_cm_id=EMMA))
    commitments = (_commitment("com-a", "500"), _commitment("com-b", "300"))
    rows = build_register(_inputs(lines=lines, commitments=commitments))
    assert {r.transaction_cm_id: r.fulfils_commitment_id for r in rows} == {9001: "com-b", 9002: "com-a"}


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


def test_a_line_with_no_inference_has_candidates_but_no_suggestion() -> None:
    line = _line(attributed_person_cm_id=0, attributed_session_cm_id=0, attribution_method="ambiguous")
    (need,) = _attention(lines=(line,)).needs_camper
    assert need.suggestion is None
    assert need.candidates == (EMMA, LIAM)


def test_applicant_households_sort_first_then_the_largest_amount() -> None:
    other_household = 150
    lines = (
        _line(9001, "100"),
        _line(9002, "900", household_cm_id=other_household),
        _line(9003, "300"),
    )
    needs = _attention(lines=lines).needs_camper
    assert [n.row.transaction_cm_id for n in needs] == [9003, 9001, 9002]
    assert [n.household_applied for n in needs] == [True, True, False]


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
