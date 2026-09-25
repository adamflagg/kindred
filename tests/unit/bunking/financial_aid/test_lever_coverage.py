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
        if typing.get_origin(info.annotation) is dict:
            value_model = _model(typing.get_args(info.annotation)[1])
            if value_model is not None:
                paths.extend(lever_paths(value_model, f"{path}.*."))
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


def test_every_lever_is_exercised_by_a_test() -> None:
    sources = "\n".join(
        p.read_text(encoding="utf-8") for p in sorted(_HERE.glob("test_*.py")) if p.name != Path(__file__).name
    )
    missing = [p for p in lever_paths(AidRules) if p not in _NOT_LEVERS and not _literal(p).search(sources)]
    assert not missing, f"No test changes these levers with with_lever(): {missing}"
