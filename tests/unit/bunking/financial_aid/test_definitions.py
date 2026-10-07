"""The definitions registry (clean spec §4.8, D20): one server-side source for the numbered notes at the
bottom of every surface that shows money, shared with Reports › Development. Its texts are §5's signed
meanings, never redefined (§5's preamble)."""

from __future__ import annotations

import re

import pytest

from bunking.financial_aid.definitions import BY_KEY, DEFINITIONS, SURFACES, Definition, render


def test_every_key_is_registered_once() -> None:
    keys = [d.key for d in DEFINITIONS]
    assert len(keys) == len(set(keys))


def test_every_surface_lists_registered_keys_once_each() -> None:
    assert set(SURFACES) >= {"requests", "household", "season-rounds-budget", "money-ledger"}
    for surface, keys in SURFACES.items():
        assert keys, surface
        assert len(keys) == len(set(keys)), surface
        assert set(keys) <= set(BY_KEY), surface


def test_the_household_band_cites_its_five_figures() -> None:
    """D77: cost − aid (decided) − grants = family's share, then Posted."""
    assert set(SURFACES["household"]) >= {"cost", "decided", "grants", "family_share", "posted"}


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_each_definition_cites_its_spec_section_and_rulings(definition: Definition) -> None:
    assert re.fullmatch(r"[a-z][a-z0-9_]*", definition.key)
    # §8 since slice 3 PR-B: "not yet in CampMinder" (D151), the suggestion (D12, D16) and the reporting group (D100)
    # are signed in §0 and written only in the spec's §8.1 (owner question 4). A citation must still be a section.
    assert re.fullmatch(r"§[5789]\.\d+", definition.spec)
    assert definition.rulings
    assert all(re.fullmatch(r"D\d+", r) for r in definition.rulings)


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_each_note_opens_with_the_term_it_defines(definition: Definition) -> None:
    assert definition.text.startswith(definition.term)


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_the_only_placeholder_is_the_camp(definition: Definition) -> None:
    """Branding: the camp is named by {camp}, which render() fills; no other placeholder exists."""
    assert "{" not in f"{definition.term} {definition.text}".replace("{camp}", "")


# Finance's three report surfaces, where "Awarded" is the report word for Posted (§5.6, D80). Development says
# "Total Awards Granted", and the two are never relabelled as each other (§5.6).
FINANCE_REPORT_SURFACES = frozenset({"reports-statistics", "reports-programs", "reports-committee"})


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_awarded_is_never_used_as_a_label(definition: Definition) -> None:
    """§5.6: "Awarded" is finance's report word for Posted (D80); no casework, Season, Money or Development note
    labels money with it. (Reports back end, a designed contract change: finance's three report surfaces are the one
    allowed place.)"""
    if "awarded" in definition.term.lower():
        showing = {surface for surface, keys in SURFACES.items() if definition.key in keys}
        assert showing, definition.key
        assert showing <= FINANCE_REPORT_SURFACES, showing


def test_render_fills_the_camp_name() -> None:
    out = render(BY_KEY["family_share"], camp="Camp Fictional")
    assert "{camp}" not in out.term + out.text
    assert "cost − Camp Fictional aid (decided) − grants" in out.text


def test_the_family_share_note_is_the_signed_formula() -> None:
    """D77 / §5.8: not a balance."""
    assert "not a balance" in BY_KEY["family_share"].text


def test_the_remaining_note_is_the_signed_formula() -> None:
    """D44, D53, D79 / §5.3."""
    assert "Allocated − Posted − Needs an offer − Pending approval" in BY_KEY["remaining"].text


def test_the_budget_surface_cites_the_budgets_own_posted() -> None:
    """Plan review minor 6: on Rounds & budget, Posted is §5.3's (less clawed-back rounds), not §5.1's tick."""
    assert "budget_posted" in SURFACES["season-rounds-budget"]
    assert "posted" not in SURFACES["season-rounds-budget"]
    assert BY_KEY["budget_posted"].spec == "§5.3"
    assert BY_KEY["budget_posted"].term == "Posted"


def test_rounds_and_budget_adds_forward_demand_and_the_confirmed_share_after_its_first_seven() -> None:
    """Appended, so notes 1–7 keep their numbers; §5.9 (D82) and the owner's ⚠10 ruling (D59, D153)."""
    keys = SURFACES["season-rounds-budget"]
    assert keys[:7] == (
        "allocated",
        "budget_posted",
        "accepted",
        "needs_offer",
        "pending_approval",
        "remaining",
        "below_the_line",
    )
    assert keys[7:10] == ("round2_asks", "round1_unmet", "unconfirmed")
    assert "held appeals' asks included" in BY_KEY["round2_asks"].text
    assert "oldest round first" in BY_KEY["unconfirmed"].text


def test_the_unconfirmed_note_cites_the_reconciliation_section() -> None:
    """The confirmed share is spec §7.2's reconciliation, not §5.3's budget posted."""
    assert BY_KEY["unconfirmed"].spec == "§7.2"


def test_the_round_1_unmet_note_names_the_three_rules_the_figure_applies() -> None:
    """Rounds outside the budget and clawed-back offers are skipped, and each family's gap is floored at $0 (the
    behaviour is pinned in test_decision_budget.py)."""
    text = BY_KEY["round1_unmet"].text
    assert "Rounds outside the budget don't count" in text
    assert "offers that were clawed back don't count" in text
    assert "each family's gap is floored at $0" in text


def test_the_confirmation_note_uses_the_pills_one_vocabulary() -> None:
    """Owner O5 (2026-10-04, late; V1's one vocabulary): the note says "pending" where the pills do."""
    text = BY_KEY["confirmation"].text
    assert text.startswith("Confirmation, beside every Posted figure: pending, then confirmed (date); ")
    assert "awaiting" not in text


def test_the_grants_note_defines_grants_applied_not_the_counted_total() -> None:
    """⚠38(b): the band's figure is grants APPLIED; the overflow shows on its own line."""
    d = BY_KEY["grants"]
    assert d.term == "Grants applied"
    assert "beyond what was owed" in d.text
    assert "still owed after camp aid" in d.text


SEASON_NOTES = (
    "allocated",
    "budget_posted",
    "accepted",
    "needs_offer",
    "pending_approval",
    "remaining",
    "below_the_line",
    "round2_asks",
    "round1_unmet",
    "unconfirmed",
    "share",
    "committed",
    "past_date",
)


def test_rounds_and_budget_numbers_thirteen_notes_appending_share_committed_and_a_past_date() -> None:
    """Spec §9.6 (owner 10-06): today's ten keep 1–10, the three new figures number 11–13."""
    assert SURFACES["season-rounds-budget"] == SEASON_NOTES


def test_allocated_is_per_pool_and_rounds_have_none() -> None:
    assert BY_KEY["allocated"].text == (
        "Allocated: per pool, the approved total × the pool's share from the approved rules' budget section (see "
        "Share); in total, the approved total, which the pools add up to. Rounds have no allocation of their own: "
        "each round shows only what it committed, and Round 3 is whatever is left in the pool."
    )


def test_remaining_is_per_pool_and_in_total_and_reads_amber_for_a_pool() -> None:
    """§8.3 (D74 amended): a pool's negative is amber, "over its share"; only the total's is red."""
    text = BY_KEY["remaining"].text
    assert text.startswith(
        "Remaining = Allocated − Posted − Needs an offer − Pending approval, per pool and in total, never per round."
    )
    assert 'reads amber, "over its share"' in text
    assert 'Only the total\'s Remaining below $0 reads red, "over budget".' in text


def test_the_totals_remaining_is_said_to_take_off_no_pool_money() -> None:
    """§5.3 note 6 matches budget.py: the total counts No pool money the pools never see (test_decision_budget)."""
    text = BY_KEY["remaining"].text
    assert "The total's Remaining is the sum of the pools', less any money in No pool." in text
    assert "The total's Remaining is the sum of the pools'. " not in text


def test_share_committed_and_a_past_date_say_the_specs_words() -> None:
    assert BY_KEY["share"].text.endswith("Only the total is a cap. There are no reserves and no round plan.")
    assert "the shares add up to 100%" in BY_KEY["share"].text
    assert BY_KEY["committed"].text == (
        "Committed: Posted + Needs an offer + Pending approval, the three figures Remaining takes away. A label for "
        "that sum, not a new measure; Accepted is inside Posted."
    )
    assert BY_KEY["past_date"].text == (
        'A past date shows what the dashboard can rebuild exactly: a figure it can\'t reads "—", never an estimate.'
    )


def test_no_season_note_cites_another_note_by_number() -> None:
    """§5.3: numbering is per surface, so "(note 6)" or "(note 11)" can't appear."""
    for key in SEASON_NOTES:
        assert "(note" not in BY_KEY[key].text


def test_scenarios_numbers_spend_remaining_projected_and_below_the_line() -> None:
    """Scenarios addendum §S6, §S11.8: Spend and Below the line are new and signed by the addendum's approval;
    Remaining is the parent's entry, reused, so the two tabs share one definition. Projected joined in PR 11."""
    assert SURFACES["season-scenarios"] == (
        "scenario_spend",
        "remaining",
        "scenario_projected",
        "scenario_below_the_line",
    )
    spend, below = BY_KEY["scenario_spend"], BY_KEY["scenario_below_the_line"]
    assert spend.text.startswith("Spend: what the applications priced would get under these settings")
    assert "Once a round posts, its posted amounts stand in every column" in spend.text
    assert below.text.startswith("Below the line, never counted in Remaining:")
    assert "This is not Rounds & budget's 'Shown, not counted'" in below.text
    # Disagreement 1: the registry admits a clean-spec section and D-numbers only; owner lines 666-685 are quoted in
    # the PR body.
    assert (spend.spec, spend.rulings) == ("§7.4", ("D35", "D38"))
    assert (below.spec, below.rulings) == ("§7.4", ("D35", "D38"))
    projected = BY_KEY["scenario_projected"]
    assert projected.text.startswith("Projected: last year's arrival curve says what share of last year's applications")
    assert "Projected figures are never amber or red" in projected.text
    assert (projected.spec, projected.rulings) == ("§7.4", ("D129", "D138"))


def test_projected_says_where_weeks_count_from_and_which_season_first_uses_received_dates() -> None:
    """Coordinator ruling (PR 11, 2026-10-07): the words match what the code does. A curve year with no approved
    deadline lines up on Jan 1, and 2027 projects on 2026's workbook, so the dashboard's own received dates (2027's
    applications) first serve the 2028 season."""
    text = BY_KEY["scenario_projected"].text
    assert "counted in weeks from the application deadline (from Jan 1 when last year's had none)." in text
    assert text.endswith(
        "Last year's curve is 2026's applications workbook, loaded once as weekly shares; from the 2028 season on, "
        "the dashboard's own received dates (2027's applications)."
    )
