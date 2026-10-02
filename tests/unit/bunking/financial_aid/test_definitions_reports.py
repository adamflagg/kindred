"""The Reports surfaces' notes (Reports back end, Part A; clean spec §4.8, §5.1, §5.6; D72, D80, D106, D129–D131):
each note is a signed §5 meaning, registered with the surface that shows it."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_three_finance_report_surfaces_have_their_notes_in_order() -> None:
    assert SURFACES["reports-statistics"] == (
        "apps",
        "cancelled_applicants",
        "awarded",
        "average_award",
        "pct_of_ask",
        "decided_not_offered",
        "recipients_cancelled",
        "appeals",
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


def test_percent_of_ask_carries_only_its_signed_meaning() -> None:
    """D80 / §5.6; the population of the asks (Decision 3) joins the note only once the owner confirms it."""
    note = BY_KEY["pct_of_ask"]
    assert (note.text, note.spec) == ("% of ask: awarded $ ÷ asked $, each round's ask as keyed.", "§5.6")


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


def test_appeals_say_cancelled_requests_count_because_the_rate_divides_by_applications() -> None:
    """D131 / OWNER ITEM NOT RULED (appeals and cancellations): the appeal rate and the per-tier appeals count every
    request with a Round 2 or later ask, cancelled ones included; RPT-23's outcomes exclude them."""
    note = BY_KEY["appeals"]
    assert note.text.startswith(note.term)
    assert "every request with a Round 2 or later ask, cancelled ones included" in note.text
    assert "the rate divides by applications, which include cancellations" in note.text
    assert note.key in SURFACES["reports-committee"] and note.key in SURFACES["reports-statistics"]
