"""Every lever in the rules document is changed by at least one test.

The spec's acceptance criterion is "staff can change every lever as a setting".
This makes the test suite prove each one is wired: it lists every leaf of
AidRules and requires each path to appear as a string literal in a test in this
directory -- which is exactly what with_lever(rules, "a.b.c", value) produces.
Dictionary keys become "*" (programs.*.r1_table matches "programs.summer.r1_table").
Labels are cosmetic and exempt.
"""

import re
import typing
from pathlib import Path

from pydantic import BaseModel

from bunking.financial_aid.rules.schema import AidRules

_HERE = Path(__file__).parent
_NOT_LEVERS = {"schema_version", "year"}

# Levers that nothing in this sub-project READS. Validation may check their shape or
# their consistency (pools summing to 100%, milestones in order), and test_schema.py
# proves a bad value is refused, but no award, trace or lookup changes when they do --
# so there is no behaviour to test yet. Each was verified by grep outside schema.py and
# validation.py (final review, 2026-09-25). Unlike _NOT_LEVERS (never meaningfully
# changeable, like a schema version number), each WILL become a normal lever once
# something reads it: the sub-project that wires one must delete its entry here and add
# a behavioural test, the same as any other lever.
_SP5 = "sub-project 5 (applications and requests) reads it; the calculator does not"
_SP9 = "sub-project 9 (scenarios, budget and targeting) reads it; the calculator does not"
_SP10 = "sub-project 10 (decisions, stages and rounds) reads it; the calculator does not"
_WIRED_BY_LATER_SUBPROJECT: dict[str, str] = {
    "stages.stages.code": _SP10,
    "stages.stages.round": _SP10,
    "stages.stages.decision_type": _SP10,
    "stages.stages.is_offer": _SP10,
    "stages.stages.is_accepted": _SP10,
    "stages.stages.is_cancel": _SP10,
    "stages.stages.counts_toward_budget": _SP10,
    "stages.stages.include_default": _SP10,
    "stages.stages.allows_appeal": _SP10,
    "awards.decision_types.*.round": _SP10,
    "milestones.application_deadline": _SP10,
    "milestones.r1_run": _SP10,
    "milestones.response_deadline": _SP10,
    "milestones.r2_window_start": _SP10,
    "milestones.r2_window_end": _SP10,
    "milestones.r3_window_start": _SP10,
    "milestones.r3_window_end": _SP10,
    "budget.total": _SP9,
    "budget.pools.*.share_pct": _SP9,
    "budget.pools.*.amount": _SP9,
    "budget.reserves": _SP9,
    "budget.spillover": _SP9,
    "budget.commit_on": _SP9,
    "awards.decision_types.*.budget_line": _SP9,
    "awards.decision_types.*.counts_toward_budget": _SP9,
    "cost.infant_age_cutoff_months": _SP5 + " (it pre-fills family-camp headcounts)",
    "awards.rounding": (
        "no sub-project yet: it allows one value, and the calculator always rounds half up "
        "(money.round_dollars); whoever adds a second value must read it"
    ),
}


def _model(annotation: object) -> type[BaseModel] | None:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None


def lever_paths(model: type[BaseModel], prefix: str = "") -> list[str]:
    paths: list[str] = []
    for name, info in model.model_fields.items():
        path = f"{prefix}{name}"
        nested = _model(info.annotation)
        if nested is not None:
            paths.extend(lever_paths(nested, f"{path}."))
            continue
        origin = typing.get_origin(info.annotation)
        if origin is dict:
            value_model = _model(typing.get_args(info.annotation)[1])
            if value_model is not None:
                paths.extend(lever_paths(value_model, f"{path}.*."))
                continue
        if origin is list:
            item_model = _model(typing.get_args(info.annotation)[0])
            if item_model is not None:
                # A list has positions, not keys, so there's nothing to wildcard the
                # way a dict's "*" stands in for a key -- the item model's own fields
                # are the levers, reached directly under the list's path with no
                # index. The list path itself is then not a leaf, consistent with a
                # nested BaseModel and a dict's value model, neither of which leaves
                # its own container path in the result.
                paths.extend(lever_paths(item_model, f"{path}."))
                continue
        if name != "label":
            paths.append(path)
    return paths


def _literal(path: str) -> re.Pattern[str]:
    return re.compile('"' + re.escape(path).replace(r"\*", r'[^."]+') + '"')


def test_the_lever_list_reaches_every_section() -> None:
    levers = lever_paths(AidRules)
    for expected in (
        "income.floor_applies_after",
        "grants.minimum_after_grants",
        "round2.cap_subtracts_grants",
        "award_tables.*.tiers.*.r1_pct",
        "programs.*.r1_table",
        "awards.decision_types.*.extra_amount",
        "budget.pools.*.share_pct",
        "quality_checks.checks.*.threshold",
        "milestones.r3_window_end",
    ):
        assert expected in levers
    assert len(levers) >= 75


def test_lever_paths_walks_into_list_of_models() -> None:
    """A `list[BaseModel]` field (tiers.bands, equity.criteria, cost.family_rates,
    stages.stages) must be walked field by field, like a nested model or a dict's
    values -- not collapsed into a single leaf that hides its own levers.
    """
    levers = lever_paths(AidRules)
    for expected in (
        "tiers.bands.lower",
        "tiers.bands.upper",
        "equity.criteria.also_fields",
        "cost.family_rates.standard",
        "stages.stages.code",
    ):
        assert expected in levers
    # The collapsed container path is not itself a lever, once its items are walked --
    # consistent with a nested BaseModel field and a dict's value model, neither of
    # which leaves the container path itself in the list.
    assert "tiers.bands" not in levers
    assert "equity.criteria" not in levers
    assert "cost.family_rates" not in levers
    assert "stages.stages" not in levers


def test_wired_by_later_subproject_entries_are_real_levers() -> None:
    """A stale deferral is as dangerous as a missing test: it would hide a lever
    that DOES have behaviour now (a rename, or the sub-project that wires it
    forgetting to delete the entry) behind a path that's no longer even real.
    """
    levers = lever_paths(AidRules)
    for path in _WIRED_BY_LATER_SUBPROJECT:
        assert path in levers, f"'{path}' is deferred in _WIRED_BY_LATER_SUBPROJECT but is not a real lever path"
    assert not set(_WIRED_BY_LATER_SUBPROJECT) & _NOT_LEVERS, "a path cannot be both deferred and not-a-lever"


# test_schema.py only proves a bad value is refused and a good one kept. That is a type
# check, not behaviour, so a literal there never counts as a lever being exercised.
_NOT_BEHAVIOUR = {Path(__file__).name, "test_schema.py"}


def test_every_lever_is_exercised_by_a_test() -> None:
    sources = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted(_HERE.glob("test_*.py")) if p.name not in _NOT_BEHAVIOUR
    )
    exempt = _NOT_LEVERS | set(_WIRED_BY_LATER_SUBPROJECT)
    missing = [p for p in lever_paths(AidRules) if p not in exempt and not _literal(p).search(sources)]
    assert not missing, f"No test changes these levers with with_lever(): {missing}"
