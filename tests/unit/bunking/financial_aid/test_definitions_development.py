"""Reports › Development's notes (Reports back end, Part B; clean spec §4.8, §5.7, §5.10, §5.11; D87–D94, D99,
D101, D103, D142): development's signed meanings, on its own surface."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY, SURFACES


def test_the_development_surface_lists_its_six_notes_in_order() -> None:
    """Final design (owner 10-09: at most six notes): Budget, Need, Total Awards, Who counts, First-time, As reported."""
    assert SURFACES["reports-development"] == (
        "dev_budget",
        "need",
        "total_awards_granted",
        "dev_recipients",
        "first_time",
        "basis_unconfirmed",
    )


def test_each_note_leads_with_the_words_the_mock_does() -> None:
    assert [BY_KEY[k].term for k in SURFACES["reports-development"]] == [
        "Budget",
        "Need and Total Requests",
        "Total Awards Granted",
        "Who counts",
        "First-time",
        "As reported",
    ]


def test_budget_is_the_first_board_passed_figure() -> None:
    text = BY_KEY["dev_budget"].text
    assert "as the board first passed it; a later revision doesn't move it" in text
    assert "An as-reported season shows the figure finance typed." in text


def test_total_awards_granted_is_all_money_never_relabelled_awarded() -> None:
    """D87, §5.6: "Awarded" and "Total Awards Granted" are never relabelled as each other."""
    note = BY_KEY["total_awards_granted"]
    assert (note.term, note.spec) == ("Total Awards Granted", "§5.7")
    assert "plus every outside grant" in note.text
    assert "Average award = Total ÷ Grants/Awards" in note.text
    assert "awarded" not in note.term.lower()


def test_need_counts_live_requests_of_campers_who_attended_at_most_the_sessions_cost() -> None:
    """D91, 29b, Rule M: the latest ask plus earlier-round awards, at most the session's cost."""
    text = BY_KEY["need"].text
    assert "for each live request of a camper who attended" in text
    assert "at most its session's cost" in text
    assert "% of need met = money received, up to need, ÷ need." in text
    assert "left out" in text  # outside grants are left out of need
    assert "never capped" not in text


def test_who_counts_folds_in_teens_gender_and_household_level_grants() -> None:
    """D89, D92-D94, D142, D103 in one note: attended and got money from any source, applied or not."""
    assert {"D89", "D92", "D93", "D94", "D103", "D142"} <= set(BY_KEY["dev_recipients"].rulings)
    text = BY_KEY["dev_recipients"].text
    assert "attended an aid-eligible session and got money from any source, applied or not" in text
    assert "Weekend counts families" in text
    assert "Teens are 13–17 on their first day" in text
    assert "Gender Identity" in text
    assert "only when the household has one eligible camper" in text


def test_first_time_note_carries_appeals() -> None:
    text = BY_KEY["first_time"].text
    assert "unless a grantor defines it" in text
    assert "Appeals: a Round 2 or later ask from a camper who attended" in text


def test_as_reported_says_the_rebuild_waits_on_the_backfill() -> None:
    text = BY_KEY["basis_unconfirmed"].text
    assert "the figures already sent to funders, typed once" in text
    assert "may count the camp's own aid only" in text
    assert "2017–2024 ledger backfill" in text
