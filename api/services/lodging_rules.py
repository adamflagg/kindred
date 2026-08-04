"""Pure decision rules for the weekend lodging surface.

No I/O, no PocketBase, no FastAPI — every function is total over plain values
so the rules can be unit-tested without a database, and so the same rule is
never re-implemented differently in the repository, the service, and React.

Scope note — what is deliberately NOT here. The share gate, the NEAR/WITH
modes and the free-text request are derived by the Go ingest into typed
columns on `family_camp_registrations` (`share_cabin_gate`, `wants_near`,
`wants_with`, `wants_similar_ages`, `request_text`), and this surface READS
those columns rather than re-parsing the raw answers. Re-deriving them in
Python would fork two documented fixes that only exist on the Go side:

- ``NormalizeShareGate`` requires the sentence to contain "shar" before it
  reads a leading "no" as a decline, because the modes field's own
  "No requests" option (209 rows across 2025-2026) otherwise parses as a hard
  no and silently strips the household's eligibility for staff pairing.
- ``ParseSharedCabinModes`` tests NEAR and WITH independently rather than as
  ordered arms, so an option naming both sets both.

The rules that remain are the ones with no ingest equivalent: they are
properties of the physical units and of per-session availability, which the
ingest never touches.
"""

from __future__ import annotations

# Values of lodging_units.bathroom. An unset PocketBase select stores as "",
# which means "nobody has told us yet", not "no bathroom".
BATHROOM_VALUES = ("none", "private", "shared")


def unit_capacity(sleeps: int | None) -> int | None:
    """Return the bed count, or None when capacity is unknown.

    PocketBase declares number columns `NUMERIC DEFAULT 0 NOT NULL`, so a
    `sleeps` value staff never filled in stores as 0 and never as NULL. Nine
    seeded units are in that state, five of them bookable -- the other four
    are container rows, which no capacity count includes anyway. 0 therefore
    means UNKNOWN: never render it as "sleeps 0" and never sum it into a
    capacity total.
    """
    if sleeps is None or sleeps <= 0:
        return None
    return int(sleeps)


def is_family_available(allocation_default: str, override: bool | None) -> bool:
    """Whether this unit can take a family this weekend, in exactly one place.

    | base          | override | family-available |
    |---------------|----------|------------------|
    | family_pool   | None     | yes              |
    | family_pool   | False    | no  (burst pipe) |
    | staff_default | None     | no               |
    | staff_default | True     | yes (released)   |

    TWO layers, not three. `lodging_availability` lost its scenario dimension
    in 1500000135 because availability is a fact about the WEEKEND rather than
    about the plan -- a burst pipe closes a cabin in every scenario for that
    weekend, so there was never anything for a scenario to disagree about.

    The row STATES the outcome rather than implying it. An earlier design had
    the row mean "the opposite of this unit's current default", which an
    ordinary registry edit -- flipping a unit from family_pool to
    staff_default -- would silently invert, turning a cabin closed for a burst
    pipe into the one cabin RELEASED to families.

    `None` and `False` are DIFFERENT answers: None means "no row, so ask the
    role", False means "closed this weekend". Never collapse the two with a
    falsy test.

    A unit created through the admin UI without an explicit
    `allocation_default` stores "" and matches neither base row. We treat "" as
    family_pool so the unit is at least visible, and the roster reports it
    separately via RosterCounts.units_missing_allocation rather than hiding
    the gap.
    """
    if override is not None:
        return override
    return allocation_default != "staff_default"


def effective_bathroom(
    bathroom: str,
    bathroom_group: str,
    group_member_codes: frozenset[str],
    merged_codes: frozenset[str],
) -> str:
    """Spec §3.2.1 — private vs shared depends on the merge state.

    Tioga 1 and Tioga 2 are each `shared`, because two families normally
    split them. Merge both and the same bathroom becomes `private`, so
    merging can itself be the accommodation for a medical bathroom request.

    Args:
        bathroom: the unit's own value ("", "none", "private", "shared").
        bathroom_group: the unit's group id, "" when it has none.
        group_member_codes: every unit code carrying that bathroom_group.
        merged_codes: the unit codes bound into the slot being evaluated
            (a one-element set for an unmerged unit).

    Returns:
        "unknown" | "none" | "private" | "shared".
    """
    if bathroom not in BATHROOM_VALUES:
        return "unknown"
    if bathroom != "shared":
        return bathroom
    if not bathroom_group:
        return "shared"
    if group_member_codes and group_member_codes <= merged_codes:
        return "private"
    return "shared"
