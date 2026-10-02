"""The Reports surfaces' notes (Reports back end, Part A; clean spec §4.8, §5.1, §5.6; D72, D80, D106, D129–D131):
each note is a signed §5 meaning, registered with the surface that shows it."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_three_finance_report_surfaces_have_their_notes_in_order() -> None:
    # Slice 4 ask 4 appends three notes, so notes 1–8 keep the numbers staff already see.
    assert SURFACES["reports-statistics"] == (
        "apps",
        "cancelled_applicants",
        "awarded",
        "average_award",
        "pct_of_ask",
        "decided_not_offered",
        "recipients_cancelled",
        "appeals",
        "pct_of_ask_with_grants",
        "round2_max_pct",
        "appeal_rate",
    )
    assert SURFACES["reports-programs"] == ("apps", "awarded", "average_award", "pct_of_ask")
    assert SURFACES["reports-committee"] == (
        "finance_budget",
        "awarded",
        "apps",
        "as_reported",
        "round1_phases",
        "appeals",
    )


def test_awarded_is_posted_on_live_requests_never_total_awards_granted() -> None:
    """D80 (awarded = offered = Posted, net of clawback), D129/D131 (a cancelled request leaves at once), D106."""
    note = BY_KEY["awarded"]
    assert (note.term, note.spec) == ("Awarded", "§5.6")
    assert "Posted" in note.text
    assert "net of any clawback" in note.text
    assert "cancelled request leaves it at once" in note.text
    assert "never Total Awards Granted" in note.text


def test_decided_not_yet_offered_is_never_called_awarded() -> None:
    """D130: a labelled second basis behind an off-by-default switch."""
    note = BY_KEY["decided_not_offered"]
    assert note.term == "Decided (not yet offered)"
    assert "never called awarded" in note.text
    assert "moves until posted" in note.text


def test_the_average_award_names_its_population() -> None:
    """O-930-16's default: D80's denominator, labelled against the sheet's."""
    assert "÷ the awarded count" in BY_KEY["average_award"].text
    assert "divide by all apps" in BY_KEY["average_award"].text


def test_typed_history_is_dollars_and_counts_with_kindred_computing_every_percent() -> None:
    assert "Kindred computes every percentage" in BY_KEY["as_reported"].text


def test_percent_of_ask_names_todays_asks_the_outside_funder_exclusion_and_the_decided_numerator() -> None:
    """D80 / §5.6; owner N1, (c) and (b) (RULED 2026-10-02)."""
    note = BY_KEY["pct_of_ask"]
    assert note.spec == "§5.6"
    # Slice 4 ask 4: the denominator is named, so nobody reads it as the Asked column (owner B4a (c), D121).
    assert note.text.startswith(
        "% of ask: awarded $ ÷ the live requests' in-budget asks: each round's ask as keyed and as it stands today, "
        "on live requests (not cancelled)."
    )
    assert "It is not the asked or requested total" in note.text
    assert "paid wholly by an outside funder" in note.text
    assert "left out of the in-budget asks" in note.text  # the fourth deliberate assertion change
    assert "Posted + Decided" in note.text
    assert "% of ask (posted + decided)" in note.text


def test_awarded_says_live_for_the_request_standing_never_included() -> None:
    """Reports' request standing is "live" (received, not cancelled, D129/D131). "Included" is the Include override
    on the Requests grid, which Reports ignore (owner item 53 default), so no note may use it in this sense."""
    text = BY_KEY["awarded"].text
    assert "on a live request" in text
    assert "included request" not in text


def test_round_1_phases_carry_their_signed_boundary() -> None:
    """D155: phase 1 = Round 1 on requests received by the application deadline; held-and-posted-later stays in 1."""
    note = BY_KEY["round1_phases"]
    assert "received by the application deadline" in note.text
    assert "stays in phase 1" in note.text
    assert note.key in SURFACES["reports-committee"]


def test_round_1_phases_define_both_columns_the_bands_and_the_total() -> None:
    """Owner N2 = C (RULED 2026-10-02): each column says what it counts, and which figures sit on which column."""
    text = BY_KEY["round1_phases"].text
    assert "As offered" in text
    assert "the lock as posted" in text
    assert "later cancellation, withdrawal or clawback never reduces it" in text
    assert "End of season" in text
    assert "net of cancellations" in text
    assert 'reads "to date" until the season closes' in text
    assert "the last session open to aid" in text
    assert "A blank stays blank" in text
    assert "one column is never filled from the other" in text
    assert "target bands compare against As offered" in text
    assert 'total, the over/under and "total − Σ phases" are End of season\'s' in text
    assert "NOT RULED" not in text


def test_appeals_say_cancelled_requests_count_because_the_rate_divides_by_applications() -> None:
    """D131 / owner ruling (RULED 2026-10-02, appeals and cancellations): the appeal rate and the per-tier appeals count every
    request with a Round 2 or later ask, cancelled ones included; RPT-23's outcomes exclude them."""
    note = BY_KEY["appeals"]
    assert note.text.startswith(note.term)
    assert "every request with a Round 2 or later ask, cancelled ones included" in note.text
    assert "the rate divides by applications, which include cancellations" in note.text
    assert note.key in SURFACES["reports-committee"]
    assert note.key in SURFACES["reports-statistics"]


def test_recipients_who_cancelled_names_a_withdrawn_request_that_holds_a_posted_award() -> None:
    """Owner (a) (RULED 2026-10-02)."""
    text = BY_KEY["recipients_cancelled"].text
    assert "or withdrawn" in text
    assert "A withdrawn request that holds a posted award counts here exactly as a cancelled one does." in text
