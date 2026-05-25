"""Diagnostics helpers for surfacing solver infeasibility to the frontend.

Stream B (#1638): the localizer (`localize_hard_mso_infeasibility`) returns
cm_ids only. The solver runner has `person_by_cm_id`; resolve names here so the
API response is self-contained (mirrors how `impossibility_report` items already
carry `requester.name`).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from bunking.models_v2 import DirectPerson


def resolve_localization(iis: dict[str, Any], person_by_cm_id: dict[int, DirectPerson]) -> dict[str, Any]:
    """Transform a `localize_hard_mso_infeasibility` IIS dict into a name-resolved shape.

    Prefers `minimal_correction_set`; falls back to `singleton_critical_cms`.
    Unknown cm_ids degrade to using the id as the display name.
    """
    cm_ids = iis.get("minimal_correction_set") or iis.get("singleton_critical_cms") or []
    campers: list[dict[str, Any]] = []
    for cm in cm_ids:
        person = person_by_cm_id.get(cm)
        if person is not None:
            campers.append(
                {
                    "cm_id": cm,
                    "name": f"{person.first_name} {person.last_name}".strip(),
                    "grade": person.grade,
                    "gender": person.gender,
                }
            )
        else:
            campers.append({"cm_id": cm, "name": str(cm), "grade": None, "gender": None})
    return {
        "approach": iis.get("approach", ""),
        "candidate_count": iis.get("candidate_count", 0),
        "campers": campers,
        "notes": iis.get("notes", ""),
    }
