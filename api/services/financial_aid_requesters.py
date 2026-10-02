"""Who requested a request's aid: the parent or guardian who submitted the aid form (Requests grid "Requested by").

The name is the form's contact name, read from the synced financial_aid_applications mirror. The chain, per request:
1. The camper's own form row(s) with a contact name decide alone: their one name, or None when they name two or
   more different people (no fallback to the household).
2. Otherwise, the request's household has exactly one distinct contact name across its form rows: that name.
3. Otherwise None: two or more different names (ambiguous, never guessed) or none at all.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from api.services.financial_aid_intake_types import RequestRecord


@dataclass(frozen=True)
class FaContact:
    """One form row's contact name and where it belongs: the camper (CampMinder person id) and household."""

    person_cm_id: int
    household_cm_id: int
    first_name: str
    last_name: str


def contact_name(first: str, last: str) -> str | None:
    """ "First Last", each part trimmed; one blank part leaves the other; both blank is no name."""
    return " ".join(p for p in (first.strip(), last.strip()) if p) or None


def _only(names: Iterable[str]) -> str | None:
    """The one distinct name (compared case-insensitively), in its first stored casing; None for none or several."""
    distinct: dict[str, str] = {}
    for name in names:
        distinct.setdefault(name.casefold(), name)
    return next(iter(distinct.values())) if len(distinct) == 1 else None


def requester_names(contacts: Iterable[FaContact], requests: Iterable[RequestRecord]) -> dict[str, str | None]:
    """Each request's id to who requested it (None: nobody could be named). `contacts` should be in a stable order."""
    own: dict[int, list[str]] = defaultdict(list)
    household: dict[int, list[str]] = defaultdict(list)
    for contact in contacts:
        name = contact_name(contact.first_name, contact.last_name)
        if name is None:
            continue
        own[contact.person_cm_id].append(name)
        household[contact.household_cm_id].append(name)
    out: dict[str, str | None] = {}
    for request in requests:
        camper = own.get(request.person_cm_id) if request.person_cm_id > 0 else None
        # A camper with own rows is answered by them alone, even when those rows disagree (never fall back).
        out[request.id] = _only(camper) if camper else _only(household.get(request.household_cm_id, ()))
    return out
