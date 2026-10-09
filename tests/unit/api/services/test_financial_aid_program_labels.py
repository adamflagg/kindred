"""Program-family labels: the rules' label where the rules name the key, the rules' `tbm` word for the bmitzvah family
(the preview season's rules key that program `tbm`, while the ledger's family is `bmitzvah`), and a fixed server word
for the families the rules never name (quest, teen, bmitzvah without a `tbm`). Unattributable buckets stay unnamed."""

from __future__ import annotations

from api.services.financial_aid_program_labels import program_labels
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


def test_the_families_the_rules_never_name_get_a_fixed_word() -> None:
    labels = program_labels(_rules(drop=("quest", "teen")))
    assert (labels["quest"], labels["teen"]) == ("Quest", "Teen Leadership")


def test_bmitzvah_without_any_rule_reads_b_star_mitzvah() -> None:
    assert program_labels(_rules(drop=("bmitzvah",)))["bmitzvah"] == "B*Mitzvah"
    assert program_labels(None)["bmitzvah"] == "B*Mitzvah"


def test_the_rules_name_beats_the_fixed_word() -> None:
    assert program_labels(_rules(add={"quest": "Fictional Quest"}))["quest"] == "Fictional Quest"


def test_unattributable_buckets_stay_unnamed() -> None:
    labels = program_labels(None)
    assert "ambiguous" not in labels
    assert "unattributed" not in labels
