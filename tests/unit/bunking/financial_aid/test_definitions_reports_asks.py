"""The slice 4 Reports asks' notes (ask 4; clean spec §4.8, §5.7, §9.2, §9.7; D80, D96, D116, D131, D132). Each
text is PENDING OWNER (owner question 1)."""

from __future__ import annotations

from bunking.financial_aid.definitions import BY_KEY


def _text(key: str) -> str:
    definition = BY_KEY.get(key)
    assert definition is not None, key
    return definition.text


def test_percent_of_ask_including_grants_keeps_outside_funded_asks_in_its_denominator_and_says_round_1_only() -> None:
    """§9.2 left its definition to the slice 4 plan; it is the server's (statistics.py), now signed in words."""
    text = _text("pct_of_ask_with_grants")
    assert text.startswith("% of ask incl. grants: ")
    assert "the counting outside grants placed on the live requests" in text
    # Owner A11 (APPROVED): unlike % of ask, the denominator keeps the rounds an outside funder pays in full.
    assert "÷ the live requests' asks, including rounds an outside funder pays in full" in text
    assert "outside-funded asks stay in its denominator" in text
    assert "in-budget" not in text
    assert "Round 1 and All rounds only" in text
    assert '"% of ask incl. grants (posted + decided)"' in text


def test_round_2_max_percent_is_a_rules_value_not_an_outcome() -> None:
    """RPT-9 (§9.7): labelled as a rules value."""
    text = _text("round2_max_pct")
    assert "Round 1 and Round 2 aid together may cover" in text
    assert "a rules value, not an outcome" in text
    assert "no Round 2 table or more than one" in text


def test_the_appeal_rate_is_kindred_derived_and_counts_cancelled_requests() -> None:
    """RPT-9 (§9.7): "appeal rate by tier is marked Kindred-derived"; owner ruling (appeals and cancellations)."""
    text = _text("appeal_rate")
    assert "appeals ÷ Round 1 apps" in text
    assert "counted at their Round 2 tier" in text
    assert "The dashboard derives it" in text
    assert "cancelled requests count on both sides" in text
    assert "not development's appeals" in text


def test_basis_unconfirmed_is_the_interim_default_until_d96_is_re_ruled() -> None:
    """§5.7 / §9.4 (O-930-1): Kindred's interim default, not a ruling."""
    definition = BY_KEY.get("basis_unconfirmed")
    assert definition is not None
    assert (definition.spec, definition.rulings) == ("§5.7", ("D96",))
    assert "{camp}'s own aid only" in definition.text
    assert "may compare two bases" in definition.text
    assert "the dashboard's interim default, not a ruling" in definition.text


def test_percent_of_ask_including_grants_counts_an_outside_funded_rounds_money_as_grants() -> None:
    """Owner A1 carried through (RULED 2026-10-02): the numerator's grants include the money of a round an outside
    funder pays in full, not only the Grants register's lines."""
    text = _text("pct_of_ask_with_grants")
    assert (
        "the counting outside grants placed on the live requests and the money of the rounds an outside funder pays in full"
        in text
    )
