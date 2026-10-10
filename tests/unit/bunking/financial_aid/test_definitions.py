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


ROUNDS_NOTES = (
    "rounds_allocated",
    "rounds_committed",
    "rounds_posted",
    "rounds_needs_offer",
    "rounds_remaining",
    "rounds_below_the_line",
)


def test_rounds_and_budget_has_its_own_six_notes_and_shares_none_with_other_surfaces() -> None:
    """Final design (rounds-4; kit §12: six at most, always shown): this surface owns its six entries, so wording them
    for the page never edits the entries Requests, Scenarios and Reports share."""
    assert SURFACES["season-rounds-budget"] == ROUNDS_NOTES
    for key in ROUNDS_NOTES:
        assert not any(key in keys for name, keys in SURFACES.items() if name != "season-rounds-budget")


def test_each_rounds_and_budget_note_opens_with_its_bold_term_and_is_the_mocks_text() -> None:
    texts = [BY_KEY[key].text for key in ROUNDS_NOTES]
    assert texts == [
        "Allocated: the approved total × the pool's share. A share is finance's guess at need, not a cap; Edit Plan… "
        "moves money between pools. Round 3 is what's left.",
        "Committed: Posted + Needs an offer + Pending approval, what Remaining takes away. Accepted sits inside "
        "Posted and is never subtracted.",
        "Posted: locked amounts of posted rounds, less clawbacks that posted. Not yet confirmed: the part "
        "CampMinder's camp aid doesn't cover yet.",
        "Needs an offer: decided, not yet posted. Pending approval: a Round 3 above the registrar's $300, waiting "
        "for finance.",
        "Remaining: Allocated − Committed, per pool and in total, never per round. A pool below $0 reads amber; "
        "only the total below $0 reads red.",
        "Below the line: shown, never counted in Remaining: outside grants, money outside the camp's budget, held "
        "requests and demand still to come.",
    ]
    for key in ROUNDS_NOTES:
        assert BY_KEY[key].text.startswith(f"{BY_KEY[key].term}:")


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
    for key in ROUNDS_NOTES:
        assert "(note" not in BY_KEY[key].text


def test_scenarios_numbers_spend_remaining_projected_and_below_the_line() -> None:
    """Scenarios addendum §S6, §S11.8; owner-approved final mock (ux3, 2026-10-09): one line each, the mock's words.
    Season-scenarios has its own Remaining entry: Rounds & budget's `remaining` is a different formula and stays."""
    assert SURFACES["season-scenarios"] == (
        "scenario_spend",
        "scenario_remaining",
        "scenario_projected",
        "scenario_below_the_line",
    )
    assert BY_KEY["scenario_spend"].text == (
        "Spend: what the applications priced would get under these settings. A what-if: nothing here touches a "
        "family or the rules, and posted amounts always stand."
    )
    assert BY_KEY["scenario_remaining"].text == (
        "Remaining: the budget's Allocated \u2212 Committed, per pool and in total, as on Rounds & budget. A pool "
        "below $0 reads amber; only the total below $0 reads red."
    )
    assert BY_KEY["scenario_projected"].text == (
        "Projected: each figure \u00f7 the share of last year's applications in by this week. Under 5% it says too "
        "early. Never amber or red."
    )
    assert BY_KEY["scenario_below_the_line"].text == (
        "Below the line: held requests, the Round 1 unmet ask and the appeals keyed so far: shown, never counted in "
        "Remaining."
    )
    # Disagreement 1: the registry admits a clean-spec section and D-numbers only; owner lines 666-685 are quoted in
    # the PR body.
    for key in ("scenario_spend", "scenario_remaining", "scenario_below_the_line"):
        assert (BY_KEY[key].spec, BY_KEY[key].rulings) == ("§7.4", ("D35", "D38"))
    assert (BY_KEY["scenario_projected"].spec, BY_KEY["scenario_projected"].rulings) == ("§7.4", ("D129", "D138"))


def test_the_shared_remaining_note_is_untouched_by_the_scenarios_wording() -> None:
    """Rounds & budget still reads the shared `remaining` entry, with its Posted − Needs an offer formula."""
    assert "remaining" in SURFACES["season-rounds-budget"]
    assert "scenario_remaining" not in SURFACES["season-rounds-budget"]
    assert BY_KEY["remaining"].text.startswith("Remaining = Allocated \u2212 Posted \u2212 Needs an offer")


def test_the_cost_note_says_an_ag_session_takes_its_parents_price() -> None:
    """A1 (spec §8): an AG session is priced at its parent session's list price."""
    cost = BY_KEY["cost"]
    # owner ★5 "Shortened footnotes", final-ux 10-09: the approved shorter wording
    assert "the session's list price (an AG session's is its parent's)" in cost.text


def test_the_cost_note_names_a_cost_staff_set() -> None:
    """F3 (spec §10): Set Cost… gives a request a cost staff set, with its reason; the footnote says so."""
    text = BY_KEY["cost"].text
    # owner ★5, final-ux 10-09: shortened; the staff-set cost stays named
    assert "Family Camp by the number of people, or a cost staff set." in text


def test_requests_footnotes_are_the_approved_shortened_wording() -> None:
    """Owner ★5 "Shortened footnotes", final-ux 10-09: the Requests mock's NOTE text, in the mock's order."""
    assert SURFACES["requests"] == ("decided", "posted", "cm_check", "cost")
    assert BY_KEY["decided"].text == (
        "Decided: the award the dashboard computed or staff set for a round. It can still move (an income "
        "correction, new rules, a grant) until the round is Posted."
    )
    assert BY_KEY["posted"].text == (
        "Posted: the round's Posted checkbox and the amount it locked. Posting in CampMinder is the offer; "
        'there is one "Posted", never two figures.'
    )
    assert BY_KEY["cm_check"].term == "CM ✓"
    assert BY_KEY["cm_check"].text == (
        "CM ✓: whether CampMinder's ledger matches what was checked Posted: ✓ matched · short / over · missing · "
        "reversed · pending (tonight's sync)."
    )
    assert BY_KEY["cost"].text == (
        "Cost: the session's list price (an AG session's is its parent's); Family Camp by the number of people, "
        "or a cost staff set."
    )


def test_the_household_page_keeps_its_confirmation_note() -> None:
    """The Requests column's "CM ✓" is its own note; the household's per-Posted-figure Confirmation is untouched."""
    assert "confirmation" in SURFACES["household"]
    assert "cm_check" not in SURFACES["household"]
