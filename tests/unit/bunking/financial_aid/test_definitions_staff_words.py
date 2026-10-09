"""Staff-visible definition text carries no internal ids (owner rulings 10-08): no RPT-n, no ruling id, no spec
section sign, no field name. The `rulings` and `spec` fields are metadata the /definitions read never sends."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import pytest
from pydantic import ValidationError

from api.schemas.financial_aid import AidSourceUpdate, OverrideBulkLoad
from api.schemas.financial_aid_grants import GrantorFields, PlaceGrantsIn
from bunking.financial_aid.definitions import BY_KEY, DEFINITIONS

INTERNAL = re.compile(r"\b(RPT-\d+|D\d{1,3}|O-\d+-\d+)\b|§|funder_type")

_SOURCE: dict[str, Any] = {
    "source_name": "Regional grant",
    "source_family": "other_outside",
    "funder_type": "outside",
    "counts_as_aid": False,
    "note": "n",
}
_PLACE: dict[str, Any] = {"transaction_cm_id": 1, "person_cm_id": 1000001}
_ROW: dict[str, Any] = {"transaction_cm_id": 1, "attributed_person_cm_id": 1000001}


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
    assert "cancelled ones included" in BY_KEY["appeals"].text  # approved final mock: shortened
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


SNAKE_KEY = re.compile(r"\b[a-z]+(?:_[a-z]+)+\b")  # a field name or a family key: counts_as_aid, camp_fa


def _messages(exc: Any) -> list[str]:
    return [e["msg"] for e in exc.value.errors()]


@pytest.mark.parametrize(
    "build",
    [
        lambda: AidSourceUpdate(**{**_SOURCE, "counts_toward_budget": True}),
        lambda: AidSourceUpdate(**{**_SOURCE, "source_family": "camp_fa", "counts_toward_budget": True}),
        lambda: GrantorFields(name="Regional fund", covers_canteen="yes"),
        lambda: GrantorFields(name="Regional fund", pays_after_camp_aid=True),
        lambda: PlaceGrantsIn(placements=[_PLACE, _PLACE]),
        lambda: OverrideBulkLoad(year=2027, source="staff", reason="r", rows=[_ROW, _ROW]),
    ],
    ids=["outside_counts", "budget_not_aid", "canteen", "pays_after", "placed_twice", "loaded_twice"],
)
def test_sources_and_grantor_refusals_name_no_field_or_key(build: Callable[[], object]) -> None:
    """A 422 a staff save can hit reads in staff words: no family key, no field name."""
    with pytest.raises(ValidationError) as exc:
        build()
    for msg in _messages(exc):
        assert SNAKE_KEY.search(msg) is None, msg


# --- the scan's residue R1: staff strings outside the definitions (owner 10-08: no staff-visible internal ids) ---

STAFF_INTERNAL = re.compile(r"\b(RPT-\d+|D\d{1,3}|O-\d+-\d+|item \d+)\b|§")


def _refusal_messages(path: str, error: str) -> list[str]:
    """Every string literal passed to `error(...)` in `path` (an f-string's literal parts joined)."""
    import ast
    from pathlib import Path

    found: list[str] = []
    for node in ast.walk(ast.parse(Path(path).read_text())):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == error and node.args:
            found.append(
                "".join(
                    n.value for n in ast.walk(node.args[0]) if isinstance(n, ast.Constant) and isinstance(n.value, str)
                )
            )
    return found


def test_the_reports_gaps_and_refusals_carry_no_internal_id() -> None:
    from api.services.financial_aid_reports_service import NOT_BUILT

    shown = [
        *NOT_BUILT.values(),
        *_refusal_messages("api/services/financial_aid_reports_service.py", "ReportsRefusedError"),
    ]
    assert [text for text in shown if STAFF_INTERNAL.search(text)] == []


def test_an_unreleasable_holds_words_carry_no_internal_id_and_the_refusal_no_code() -> None:
    from bunking.financial_aid.decisions.holds import UNRELEASABLE

    assert [why for why in UNRELEASABLE.values() if STAFF_INTERNAL.search(why)] == []
    refusals = _refusal_messages("api/services/financial_aid_decisions_service.py", "DecisionRefusedError")
    assert [text for text in refusals if "hold can't be released" in text and "' hold" in text] == []
