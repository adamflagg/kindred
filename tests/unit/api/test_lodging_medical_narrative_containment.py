"""The medical narrative must not be reachable from any roster payload (spec §5).

family_camp_medical holds detailed medical disclosures about named
individuals — chronic conditions, post-surgical needs, CPAP dependence,
infants. Spec §5 requires: derived flag on the board, narrative only behind
an explicit permission-checked reveal, and never in an export payload.

This test walks the model graph rather than eyeballing one class, so a
narrative field smuggled into a nested model three levels down still fails.
"""

import re
from pathlib import Path
from typing import Any, get_args, get_origin

from pydantic import BaseModel

from api.schemas.lodging import (
    MEDICAL_NARRATIVE_FIELD_NAMES,
    HouseholdMedicalResponse,
    WeekendRosterResponse,
    WeekendSessionListResponse,
    WeekendSummaryResponse,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
GO_NARRATIVE_GUARD = REPO_ROOT / "pocketbase" / "sync" / "lodging_phi_test.go"


def _reachable_models(model: type[BaseModel], seen: set[type[BaseModel]] | None = None) -> set[type[BaseModel]]:
    """Every BaseModel reachable from `model`, including through list/optional."""
    seen = seen if seen is not None else set()
    if model in seen:
        return seen
    seen.add(model)
    for field in model.model_fields.values():
        for candidate in _unwrap(field.annotation):
            if isinstance(candidate, type) and issubclass(candidate, BaseModel):
                _reachable_models(candidate, seen)
    return seen


def _unwrap(annotation: Any) -> list[Any]:
    origin = get_origin(annotation)
    if origin is None:
        return [annotation]
    out: list[Any] = []
    for arg in get_args(annotation):
        out.extend(_unwrap(arg))
    return out


def _all_field_names(model: type[BaseModel]) -> set[str]:
    names: set[str] = set()
    for reachable in _reachable_models(model):
        names |= set(reachable.model_fields.keys())
    return names


def _go_narrative_columns() -> set[str]:
    """The phiColumns list from the Go export/logging guard.

    The Go identifier keeps its historical name; this side reads it by that
    name, which is why the literal survives the rename.
    """
    source = GO_NARRATIVE_GUARD.read_text()
    block = re.search(r"var phiColumns = \[\]string\{(.*?)\}", source, re.DOTALL)
    assert block, "could not find phiColumns in lodging_phi_test.go"
    return set(re.findall(r'"([^"]+)"', block.group(1)))


def test_narrative_field_names_are_declared() -> None:
    """The eight family_camp_medical narrative columns."""
    assert (
        frozenset(
            {
                "cpap_info",
                "physician_info",
                "special_needs_info",
                "allergy_info",
                "dietary_info",
                "additional_info",
                "bathroom_explain",
                "accommodation_explain",
            }
        )
        == MEDICAL_NARRATIVE_FIELD_NAMES
    )


def test_narrative_field_names_match_the_go_guard() -> None:
    """Python and Go must agree on which columns are narrative text.

    Go's list keeps the narrative out of exports and logs; this list keeps it
    out of API payloads. A column added to family_camp_medical and registered in
    only one of them is protected on one side and silently exposed on the
    other — which is exactly how bathroom_explain and accommodation_explain
    came to be missing from the original six-name Python list.
    """
    assert set(MEDICAL_NARRATIVE_FIELD_NAMES) == _go_narrative_columns()


def test_roster_response_graph_contains_no_narrative_field() -> None:
    leaked = _all_field_names(WeekendRosterResponse) & MEDICAL_NARRATIVE_FIELD_NAMES
    assert not leaked, f"narrative fields reachable from the roster payload: {sorted(leaked)}"


def test_session_list_response_graph_contains_no_narrative_field() -> None:
    leaked = _all_field_names(WeekendSessionListResponse) & MEDICAL_NARRATIVE_FIELD_NAMES
    assert not leaked, f"narrative fields reachable from the session list payload: {sorted(leaked)}"


def test_summary_response_graph_contains_no_narrative_field() -> None:
    """The lander batches counts for every weekend in a year.

    It is built from the same helpers as the roster, so it inherits the same
    exposure surface -- which is exactly why it needs its own walk. A model
    added to the summary path would otherwise never be checked.
    """
    leaked = _all_field_names(WeekendSummaryResponse) & MEDICAL_NARRATIVE_FIELD_NAMES
    assert leaked == set(), f"narrative reachable from WeekendSummaryResponse: {sorted(leaked)}"


def test_household_medical_response_is_the_only_narrative_carrier() -> None:
    """The gated endpoint's model does carry the narrative — that is its job."""
    assert set(HouseholdMedicalResponse.model_fields.keys()) >= MEDICAL_NARRATIVE_FIELD_NAMES


def test_roster_exposes_presence_flags_not_narrative() -> None:
    from api.schemas.lodging import AccessibilityFlagSummary

    names = set(AccessibilityFlagSummary.model_fields.keys())
    # kindred#1889: `has_medical_narrative` is GONE, and its absence is the
    # point. It was true for 745/745 households in 2026 and 100.0% in each of
    # 2024-26 -- the negative answers to these questions are stored as the
    # text "No", which is non-empty. A flag that is always on carries no
    # information, and the boilerplate-negative filter the issue proposed
    # still lands at 67.7% / 52.6% / 55.9% across those years, swinging 15
    # points annually.
    #
    # Deleting it rather than fixing it is what removes the year's medical map
    # from the roster read entirely -- see
    # `test_the_roster_never_reads_the_years_medical_narratives`. Nothing is
    # lost on the surface: a `bunking.manage` holder sees the narrative itself
    # (kindred#2312 retargeted that gate from the now-removed `lodging.phi`
    # permission),
    # and a non-holder was only ever being told that a disclosure they cannot
    # read exists.
    assert "has_medical_narrative" not in names
    assert "needs_private_bathroom" in names
    assert "needs_power" in names
    assert "has_infant" in names
    assert not names & MEDICAL_NARRATIVE_FIELD_NAMES


def test_every_model_in_the_module_is_walked_not_just_the_named_roots() -> None:
    """The walk is TOTAL, so a new model cannot be added outside it.

    The per-root tests above each name one payload, which means a model added
    to the module and returned by a new endpoint is checked by nothing until
    somebody remembers to add a fourth test. This closes that: every BaseModel
    declared in api.schemas.lodging is walked, and the only one permitted to
    carry narrative is the response of the endpoint gated on `bunking.manage`
    (kindred#2312 retargeted the gate from the now-removed `lodging.phi`).

    The write layer (1500000132) is the first thing this catches that the named
    roots do not -- its request models are reachable from no response payload
    at all, so nothing else here would ever look at them.
    """
    import inspect

    from api.schemas import lodging as lodging_schemas

    declared = [
        obj
        for _, obj in inspect.getmembers(lodging_schemas, inspect.isclass)
        if issubclass(obj, BaseModel) and obj.__module__ == lodging_schemas.__name__
    ]
    assert declared, "found no models to walk; the discovery above is broken"

    offenders: dict[str, list[str]] = {}
    for model in declared:
        if model is HouseholdMedicalResponse:
            continue
        leaked = _all_field_names(model) & MEDICAL_NARRATIVE_FIELD_NAMES
        if leaked:
            offenders[model.__name__] = sorted(leaked)

    assert not offenders, f"narrative fields reachable from non-gated models: {offenders}"
