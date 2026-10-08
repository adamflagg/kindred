"""Staff-visible definition text carries no internal ids (owner rulings 10-08): no RPT-n, no ruling id, no spec
section sign, no field name. The `rulings` and `spec` fields are metadata the /definitions read never sends."""

from __future__ import annotations

import re

from bunking.financial_aid.definitions import BY_KEY, DEFINITIONS

INTERNAL = re.compile(r"\b(RPT-\d+|D\d{2,3}|O-\d+-\d+)\b|§|funder_type")


def test_no_definition_text_carries_an_internal_id() -> None:
    offenders = {d.key: INTERNAL.findall(d.text) or ["funder_type/§"] for d in DEFINITIONS if INTERNAL.search(d.text)}
    assert offenders == {}


def test_no_definition_term_carries_an_internal_id() -> None:
    assert [d.key for d in DEFINITIONS if INTERNAL.search(d.term)] == []


def test_three_facts_names_the_flag_in_plain_english() -> None:
    text = BY_KEY["source_facts"].text
    assert "a flag set on each source" in text
    assert "funder_type" not in text


def test_the_other_rewritten_notes_still_read() -> None:
    assert "(awarded means offered)" in BY_KEY["round1_phases"].text
    assert "which include cancellations." in BY_KEY["appeals"].text
    assert "Since D158" not in BY_KEY["dev_appeals"].text
    assert "may have counted {camp}'s own aid only." in BY_KEY["basis_unconfirmed"].text


def test_refusal_messages_carry_no_internal_id() -> None:
    import pytest
    from pydantic import ValidationError

    from api.schemas.financial_aid_decisions import CancellationIn, CostOverrideIn
    from api.services.financial_aid_cancellations import parse_reason

    with pytest.raises(ValidationError) as cancel:
        CancellationIn(cancelled=True)
    with pytest.raises(ValidationError) as cost:
        CostOverrideIn(amount=100.0, note="x")
    with pytest.raises(ValueError) as reason:
        parse_reason("made up")
    for err in (cancel, cost, reason):
        assert INTERNAL.search(str(err.value)) is None
