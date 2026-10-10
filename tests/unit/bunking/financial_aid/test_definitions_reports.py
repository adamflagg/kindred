"""The Reports surfaces' notes (Reports back end, Part A; clean spec §4.8, §5.1, §5.6; D72, D80, D106, D129–D131):
each note is a signed §5 meaning, registered with the surface that shows it."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_three_finance_report_surfaces_have_their_notes_in_order() -> None:
    # Approved final mock reports-statistics.html: the Statistics footer is six notes (cap 6), in this order.
    assert SURFACES["reports-statistics"] == (
        "apps",
        "awarded",
        "average_award",
        "pct_of_ask",
        "appeals",
        "decided_not_offered",
    )
    assert SURFACES["reports-programs"] == ("apps", "awarded", "average_award", "pct_of_ask")
    # Approved final mock reports-yoy.html: six notes, in this order. Year over year words three of them its own
    # way (committee_*), so Statistics' shared keys keep Statistics' wording.
    assert SURFACES["reports-committee"] == (
        "finance_budget",
        "committee_awarded",
        "committee_apps",
        "as_reported",
        "round1_phases",
        "committee_appeals",
    )


def test_awarded_is_posted_on_live_requests_the_camps_own_aid_unlike_developments_grants_awards() -> None:
    """D80 (awarded = offered = Posted, net of clawback), D129/D131 (live requests only), D106; the approved final
    mock reports-statistics.html shortened the note."""
    note = BY_KEY["awarded"]
    assert (note.term, note.spec) == ("Awarded", "§5.6")
    assert "Posted" in note.text
    assert "net of clawbacks" in note.text
    assert "on live requests" in note.text
    assert "the camp's own aid only" in note.text
    assert "unlike Development's Grants/Awards" in note.text


def test_decided_not_yet_offered_is_never_called_awarded() -> None:
    """D130: a labelled second basis behind an off-by-default switch."""
    note = BY_KEY["decided_not_offered"]
    assert note.term == "Not yet offered"  # approved final mock: the shortened footnote
    assert "never called awarded" in note.text
    assert "moves until posted" in note.text


def test_the_average_award_names_its_population() -> None:
    """O-930-16's default: D80's denominator, labelled against the sheet's."""
    assert "awarded $ ÷ awards" in BY_KEY["average_award"].text
    assert "divide by every app, $0 included" in BY_KEY["average_award"].text


def test_typed_history_is_dollars_and_counts_with_kindred_computing_every_percent() -> None:
    # Approved final mock reports-yoy.html: the P / r note, the season header's own.
    note = BY_KEY["as_reported"]
    assert note.term == "P and r"
    assert note.text.startswith("P and r: P = the dashboard's Posted; r = as reported")
    assert "The dashboard computes every %." in note.text


def test_percent_of_ask_names_todays_asks_the_outside_funder_exclusion_and_the_decided_numerator() -> None:
    """D80 / §5.6; owner N1, (c) and (b) (RULED 2026-10-02)."""
    note = BY_KEY["pct_of_ask"]
    assert note.spec == "§5.6"
    # Approved final mock reports-statistics.html: the shortened footnote names the denominator and Incl. grants.
    assert note.text.startswith("% of ask: awarded $ ÷ the live requests' in-budget asks.")
    assert "Incl. grants adds outside grants and fully funded rounds to both sides" in note.text
    assert "Round 1 and All rounds" in note.text
    # Owner A5 (2026-10-09): the denominator is on Asked's capped basis, and the note says so.
    assert "capped as Asked is" in note.text


def test_awarded_says_live_for_the_request_standing_never_included() -> None:
    """Reports' request standing is "live" (received, not cancelled, D129/D131). "Included" is the Include override
    on the Requests grid, which Reports ignore (owner item 53 default), so no note may use it in this sense."""
    text = BY_KEY["awarded"].text
    assert "on live requests" in text
    assert "included request" not in text


def test_round_1_phases_carry_their_signed_boundary() -> None:
    """D155: phase 1 = Round 1 on requests received by the deadline; approved final mock reports-yoy.html shortens it."""
    note = BY_KEY["round1_phases"]
    assert note.text == (
        "Round 1 phases: 1 = Round 1 on requests in by the deadline, 2 = Round 1 after it, 3 = appeals. "
        "As offered never drops; End of season is net of cancellations."
    )
    assert note.key in SURFACES["reports-committee"]


def test_round_1_phases_name_both_columns() -> None:
    """Owner N2 = C: each column says what it counts; the long definition moved into the column titles."""
    text = BY_KEY["round1_phases"].text
    assert "As offered never drops" in text
    assert "End of season is net of cancellations" in text
    assert "NOT RULED" not in text


def test_appeals_say_cancelled_requests_count_and_the_rate_divides_by_round_1_apps() -> None:
    """D131 / owner ruling (RULED 2026-10-02, appeals and cancellations): the appeal rate and the per-tier appeals count every
    request with a Round 2 or later ask, cancelled ones included; RPT-23's outcomes exclude them."""
    note = BY_KEY["appeals"]
    assert note.text.startswith(note.term)
    assert "requests with a Round 2 or later ask, cancelled ones included" in note.text
    assert "appeal rate = appeals ÷ Round 1 apps" in note.text
    assert note.key in SURFACES["reports-statistics"]
    # Approved final mock reports-yoy.html: Year over year carries its own wording, under its own key.
    assert "committee_appeals" in SURFACES["reports-committee"]
    assert "cancelled ones included" in BY_KEY["committee_appeals"].text


def test_recipients_who_cancelled_names_a_withdrawn_request_that_holds_a_posted_award() -> None:
    """Owner (a) (RULED 2026-10-02)."""
    text = BY_KEY["recipients_cancelled"].text
    assert "or withdrawn" in text
    assert "A withdrawn request that holds a posted award counts here exactly as a cancelled one does." in text


def test_recipients_who_cancelled_names_a_confirmed_duplicate_that_holds_a_posted_award() -> None:
    """Owner ruling, queue 4 (RULED): a confirmed duplicate with a posted award counts on its own Duplicate line."""
    text = BY_KEY["recipients_cancelled"].text
    assert "a confirmed duplicate that holds one, on its own Duplicate line" in text


def test_awarded_counts_live_requests_only() -> None:
    """Owner A11 (APPROVED): live means not cancelled, withdrawn or a pending duplicate. The approved final mock
    reports-statistics.html shortened the note to "on live requests"; the exclusions are A11's, not the note's."""
    assert "on live requests" in BY_KEY["awarded"].text


def test_awards_count_explains_why_it_differs_from_developments_grants_awards() -> None:
    """The Statistics Awards column carries this note: the camp's own Posted money above $0, not every source."""
    note = BY_KEY["awarded_count"]
    assert note.term == "Awards"
    assert note.text.startswith("Awards: ")
    assert "{camp}'s own Posted money above $0" in note.text
    assert "Grants/Awards counts every source" in note.text


def test_the_statistics_note_texts_are_the_approved_mocks() -> None:
    """Approved final mock reports-statistics.html: the six shortened footnotes, each opening with its term."""
    assert BY_KEY["apps"].text.startswith(
        "Apps: requests received (camper × session; household × session for Family Camp)"
    )
    assert BY_KEY["apps"].text.endswith("Refused duplicates are left out.")
    assert BY_KEY["pct_of_ask"].text.startswith("% of ask: awarded $ ÷ the live requests' in-budget asks.")
    assert "Incl. grants adds outside grants and fully funded rounds to both sides" in BY_KEY["pct_of_ask"].text
    assert BY_KEY["decided_not_offered"].term == "Not yet offered"
    assert BY_KEY["decided_not_offered"].text.endswith("it moves until posted.")
    assert "R2 max fee % is a rules value, not an outcome" in BY_KEY["appeals"].text


def test_the_year_over_year_note_texts_are_the_approved_mock() -> None:
    """Approved final mock reports-yoy.html: the six shortened notes, each opening with its term."""
    assert BY_KEY["finance_budget"].text == (
        "Budget: {camp}'s own Total FA budget, as finance and the board approved it. Only the total is hard; "
        "the pool split is finance's soft setting."
    )
    assert BY_KEY["committee_awarded"].text == (
        "Awarded: Posted, net of clawbacks, on live requests. The camp's own aid only, never Total Awards "
        "Granted: outside grants are left out."
    )
    assert BY_KEY["committee_apps"].text == (
        "Applications: camper × session (household × session for Family Camp), cancelled ones included. "
        "Asks are Round 1 asks only, as they stood at the cutoff."
    )
    assert BY_KEY["as_reported"].text == (
        "P and r: P = the dashboard's Posted; r = as reported, finance's own figures typed once from the "
        "committee decks. The dashboard computes every %."
    )
    assert BY_KEY["committee_appeals"].text == (
        "Appeals: requests with any Round 2 or later ask, cancelled ones included. Not Development's appeals "
        "figure, which counts a different population."
    )


def test_year_over_year_wording_leaves_statistics_alone() -> None:
    """The shared keys keep Statistics' wording; Year over year's own keys carry its own."""
    assert BY_KEY["awarded"].text.startswith("Awarded: Posted, net of clawbacks, on live requests: ")
    assert BY_KEY["apps"].text.startswith("Apps: requests received")
    assert "R2 max fee % is a rules value" in BY_KEY["appeals"].text
    for key in ("committee_awarded", "committee_apps", "committee_appeals"):
        assert key not in SURFACES["reports-statistics"]
        assert key in SURFACES["reports-committee"]
