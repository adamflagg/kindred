"""Program-family labels, one vocabulary for Requests, the Ledger, Grants and the Rules card (ux3 taxonomy): each family
has ONE fixed word (summer is At Camp, never the rules' "Summer"), except the bmitzvah family, which reads the rules'
`tbm` word (the rules key that program `tbm`, while the ledger's family is `bmitzvah`) and TBM without one.
Unattributable buckets stay unnamed."""

from __future__ import annotations

from api.services.financial_aid_grants_register import PROGRAM_FAMILY_BY_SESSION_TYPE
from api.services.financial_aid_program_labels import FAMILY_WORDS, program_labels
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.bunking.financial_aid.fixtures import fictional_rules


def _rules(*, drop: tuple[str, ...] = (), add: dict[str, str] | None = None) -> AidRules:
    """fictional_rules with some program keys dropped and others added (each a copy of Family camp, relabelled)."""
    base = fictional_rules()
    template = base.programs["family_camp"]
    programs = {k: v for k, v in base.programs.items() if k not in drop}
    programs.update({k: template.model_copy(update={"label": label}) for k, label in (add or {}).items()})
    return base.model_copy(update={"programs": programs})


def test_the_bmitzvah_family_reads_the_rules_tbm_label() -> None:
    assert program_labels(_rules(drop=("bmitzvah",), add={"tbm": "TBM"}))["bmitzvah"] == "TBM"


def test_a_bmitzvah_key_the_rules_name_wins_over_the_tbm_alias() -> None:
    labels = program_labels(_rules(add={"tbm": "TBM", "bmitzvah": "Fictional B Program"}))
    assert labels["bmitzvah"] == "Fictional B Program"


def test_every_family_has_one_fixed_word_whatever_the_rules_call_the_program() -> None:
    labels = program_labels(_rules())
    assert {k: labels[k] for k in FAMILY_WORDS} == {
        "summer": "At Camp",
        "quest": "Quests",
        "teen": "Teen Programs",
        "family_camp": "Family Camp",
        "adult_weekend": "Adult Weekends",
        "family_school": "Family School",
    }


def test_adult_weekend_is_named_so_the_ledger_never_reads_other_program() -> None:
    assert program_labels(None)["adult_weekend"] == "Adult Weekends"


def test_the_fixed_word_beats_the_rules_name() -> None:
    assert program_labels(_rules(add={"quest": "Fictional Quest"}))["quest"] == "Quests"


def test_bmitzvah_without_any_rule_reads_tbm() -> None:
    assert program_labels(_rules(drop=("bmitzvah",)))["bmitzvah"] == "TBM"
    assert program_labels(None)["bmitzvah"] == "TBM"


def test_the_family_words_cover_every_family_the_session_types_map_to() -> None:
    families = set(PROGRAM_FAMILY_BY_SESSION_TYPE.values()) - {"bmitzvah"}
    assert families <= set(FAMILY_WORDS)


def test_unattributable_buckets_stay_unnamed() -> None:
    labels = program_labels(None)
    assert "ambiguous" not in labels
    assert "unattributed" not in labels
