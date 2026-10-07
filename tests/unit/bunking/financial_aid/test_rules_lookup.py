"""The one table resolver (spec §9.9; §8.5, owner 10-06: "the equity class determines the table - its a 1:1
relationship"). A legacy program (stored with `r1_table`, no flag) keeps its stored tables. Fictional only."""

import pytest

from bunking.financial_aid.rules.lookup import Round2TableNotListedError, round1_table, round2_table
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_levers


def test_a_stored_program_with_r1_table_loads_as_legacy_and_keeps_its_tables() -> None:
    rules = fictional_rules()  # every fixture program carries r1_table, as 2026's file does
    assert not any(p.table_from_equity_class for p in rules.programs.values())
    assert round1_table(rules, rules.programs["adult_weekend"]) is None  # 2026: no Round 1 table
    assert round2_table(rules, "family_school") is None
    assert round1_table(rules, rules.programs["teen"]) == "teen"


def test_a_program_by_class_takes_both_tables_from_its_equity_class() -> None:
    rules = with_levers(fictional_rules(), {"programs.adult_weekend.table_from_equity_class": True})
    program = rules.programs["adult_weekend"]
    assert (round1_table(rules, program), round2_table(rules, "adult_weekend")) == ("family", "family")


def test_a_program_by_class_with_no_class_has_no_table() -> None:
    rules = with_levers(fictional_rules(), {"programs.family_school.table_from_equity_class": True})
    assert (round1_table(rules, rules.programs["family_school"]), round2_table(rules, "family_school")) == (None, None)


def test_a_legacy_program_missing_from_program_tables_raises_not_listed() -> None:
    rules = fictional_rules()
    doc = rules.model_dump(mode="json")
    del doc["round2"]["program_tables"]["quest"]
    from bunking.financial_aid.rules.schema import AidRules

    with pytest.raises(Round2TableNotListedError) as caught:
        round2_table(AidRules.model_validate(doc), "quest")
    assert caught.value.program_key == "quest"
