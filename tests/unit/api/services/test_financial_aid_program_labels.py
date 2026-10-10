"""Program-family labels, one vocabulary for Requests, the Ledger, Grants and the Rules card (ux3 taxonomy): each family
has ONE fixed word (summer is At Camp, never the rules' "Summer"), except the bmitzvah family, which reads the rules'
`tbm` word (the rules key that program `tbm`, while the ledger's family is `bmitzvah`) and TBM without one.
Unattributable buckets stay unnamed."""

from __future__ import annotations

from api.services.financial_aid_grants_register import PROGRAM_FAMILY_BY_SESSION_TYPE
from api.services.financial_aid_program_labels import FAMILY_WORDS, program_labels, section_words
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


def test_the_approved_reads_section_words_match_program_labels_for_the_same_rules() -> None:
    """The approved read names programs from its `programs` section content (the document dumped to JSON); it must
    say exactly what `program_labels` says for the same rules, or Funders and the Ledger disagree."""
    for rules in (_rules(), _rules(drop=("bmitzvah",), add={"tbm": "Fictional TBM"})):
        assert section_words(rules.model_dump(mode="json")["programs"]) == program_labels(rules)
    assert section_words(None) == program_labels(None)


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


def test_the_rules_card_sub_sections_use_the_same_words_and_families_as_the_server() -> None:
    """Drift guard: the Rules Programs card (programsCostsModel.ts) holds its own session type -> sub-section map and
    its words (At Camp / Quests / Teen Programs). Each must agree with PROGRAM_FAMILY_BY_SESSION_TYPE and FAMILY_WORDS,
    or the card names a family differently from Requests, the Ledger and Grants."""
    import re
    from pathlib import Path

    ts = (
        Path(__file__).parents[4] / "frontend/src/components/camperships/season/rules/programsCostsModel.ts"
    ).read_text()

    def literal(name: str) -> dict[str, str]:
        body = ts.split(f"export const {name}", 1)[1].split("= {", 1)[1].split("}", 1)[0]
        pairs = dict(re.findall(r"^\s*(\w+):\s*'([^']*)',?\s*$", body, re.MULTILINE))
        entries = [ln for ln in body.splitlines() if ln.strip() and not ln.strip().startswith("//")]
        assert len(pairs) == len(entries), f"an entry of {name} the pattern can't parse would be skipped silently"
        return pairs

    sub_of_type = literal("SUBSECTION_OF_TYPE")
    words = literal("SUBSECTION_LABELS")
    assert {t: PROGRAM_FAMILY_BY_SESSION_TYPE[t] for t in sub_of_type} == sub_of_type
    assert {sub: FAMILY_WORDS[sub] for sub in words if sub != "other"} == {
        sub: word for sub, word in words.items() if sub != "other"
    }
