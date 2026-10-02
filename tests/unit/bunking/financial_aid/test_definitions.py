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
    assert re.fullmatch(r"§[57]\.\d+", definition.spec)
    assert definition.rulings
    assert all(re.fullmatch(r"D\d+", r) for r in definition.rulings)


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_each_note_opens_with_the_term_it_defines(definition: Definition) -> None:
    assert definition.text.startswith(definition.term)


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_the_only_placeholder_is_the_camp(definition: Definition) -> None:
    """Branding: the camp is named by {camp}, which render() fills; no other placeholder exists."""
    assert "{" not in f"{definition.term} {definition.text}".replace("{camp}", "")


@pytest.mark.parametrize("definition", DEFINITIONS, ids=lambda d: d.key)
def test_awarded_is_never_used_as_a_label(definition: Definition) -> None:
    """§5.6: "Awarded" is finance's report word for Posted (D80); no note labels money with it."""
    assert "awarded" not in definition.term.lower()


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
    assert keys[7:] == ("round2_asks", "round1_unmet", "unconfirmed")
    assert "held appeals' asks included" in BY_KEY["round2_asks"].text
    assert "oldest round first" in BY_KEY["unconfirmed"].text


def test_the_unconfirmed_note_cites_the_reconciliation_section() -> None:
    """The confirmed share is spec §7.2's reconciliation, not §5.3's budget posted."""
    assert BY_KEY["unconfirmed"].spec == "§7.2"
