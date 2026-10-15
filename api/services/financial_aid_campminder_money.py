"""CampMinder's live camp aid by family x session: the 2026 loader's rule (scripts/financial_aid/load_2026_decisions.py),
and D170's "CampMinder aid on no request", which Rounds & budget shows for 2026 from the same split.

Pure functions over records a caller read. Nothing here writes.

The family x session rule (owner, 10-07) is NOT the live ledger's placement (financial_aid_reconciliation.build_ledger):
the ledger puts a line on ONE request, and leaves a household line with several candidates at family level; the loader
asks only which family x session the money is for, so it can put CampMinder's money on that group's requests. D170's
line is the money whose family x session has no request at all, which is what the drift audit's residue counted."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Sequence
from decimal import Decimal
from typing import Any, Protocol

from api.services.financial_aid_ledger_service import family_household_set
from api.services.financial_aid_reconciliation import CampLine
from bunking.financial_aid.decisions.budget import NO_POOL, TOTAL, OffRequestAid
from bunking.financial_aid.money import ZERO

Group = tuple[int, int]  # (household CampMinder id, session CampMinder id): the family x session (owner, 10-07)


class GroupRequest(Protocol):
    """What the rule reads of a request, of any status: the loader's LoadRequest and the service's RequestRecord."""

    @property
    def household_cm_id(self) -> int: ...
    @property
    def person_cm_id(self) -> int: ...
    @property
    def session_cm_id(self) -> int: ...


def _line_group(
    line: CampLine, requests: Sequence[GroupRequest], linked: Collection[int] = ()
) -> tuple[Group | None, str]:
    """The family x session a live camp-aid line is for, from its own household's requests: Go's attributed session,
    else the session of the attributed camper's one request there, else the household's one session. ("", group) when
    found; else why not: "no_request" (a session the household asked no aid for) or "unplaced" (it can't be told).

    CampMinder sometimes posts a family's aid under another of its household ids (aid_household_links, D26). Only when
    the line's own household has no request that could take it are the households `linked` to it read the same way,
    and the line then joins the one linked household's family x session that can; the household's own requests always
    come first, so a link never moves money off them."""
    session, person = line.attributed_session_cm_id, line.attributed_person_cm_id

    def takers(households: Collection[int]) -> set[Group]:
        return {
            (r.household_cm_id, r.session_cm_id)
            for r in requests
            if r.household_cm_id in households
            and r.session_cm_id
            and (r.session_cm_id == session if session else not person or r.person_cm_id in (person, 0))
        }

    found = takers({line.household_cm_id}) or takers(set(linked) - {line.household_cm_id})
    if len(found) == 1:
        return found.pop(), ""
    if session:
        return (line.household_cm_id, session), "no_request"
    return None, "unplaced"


def campminder_money(
    lines: Iterable[CampLine], requests: Sequence[GroupRequest], links: Iterable[Any] = ()
) -> tuple[dict[Group, Decimal], dict[Group, Decimal], dict[int, Decimal]]:
    """CampMinder's net live camp aid per family x session that has an aid request; per family x session that has
    none; and per household, what no family x session could take. `links` are the season's aid_household_links rows
    (family_household_set reads them: an excluded row joins nothing)."""
    links = list(links)
    families: dict[int, list[int]] = {}
    placed: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    no_request: dict[Group, Decimal] = defaultdict(lambda: ZERO)
    unplaced: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for line in lines:
        if not line.live():
            continue
        if line.household_cm_id not in families:
            families[line.household_cm_id] = family_household_set(links, line.household_cm_id)
        group, why = _line_group(line, requests, families[line.household_cm_id])
        if group is None:
            unplaced[line.household_cm_id] += line.amount
        elif why:
            no_request[group] += line.amount
        else:
            placed[group] += line.amount
    return dict(placed), dict(no_request), dict(unplaced)


def aid_on_no_request(
    lines: Iterable[CampLine],
    requests: Sequence[GroupRequest],
    links: Iterable[Any],
    pool_of_session: Callable[[int], str | None],
) -> dict[str, OffRequestAid]:
    """D170: CampMinder's live camp aid that matches no request, by budget pool (its session's; NO_POOL for a session no
    program claims) and TOTAL, each with the households it is on. Only scopes holding some are keyed.

    Each live line is read by the loader's family x session rule (_line_group, with the household's links), and counts
    when it lands on:
      - a family x session with no request of any status (a family with no application, a sibling's session the
        household asked nothing for), unless the family holds a request intake matched to no session whose camper is
        the line's, or either is the household: the loader posts such a request at the sheet's session, so that money
        is on it;
      - nothing it can be told, on a family (its household and the households linked to it) with no request at all.
        It has no session, so it counts in TOTAL only.
    Money no one request can take on a family that did ask is not counted: the loader leaves the sheet's decision
    standing for it (its "not placeable on one request"), so it is on a decision already."""
    links = list(links)
    asked = {r.household_cm_id for r in requests}
    sessionless: dict[int, set[int]] = defaultdict(set)
    for request in requests:
        if not request.session_cm_id:
            sessionless[request.household_cm_id].add(request.person_cm_id)
    families_of: dict[int, list[int]] = {}
    amounts: dict[str, Decimal] = defaultdict(lambda: ZERO)
    families: dict[str, set[int]] = defaultdict(set)

    def add(scopes: Iterable[str], line: CampLine) -> None:
        for scope in scopes:
            amounts[scope] += line.amount
            families[scope].add(line.household_cm_id)

    for line in lines:
        if not line.live() or not line.amount:
            continue
        household = line.household_cm_id
        if household not in families_of:
            families_of[household] = family_household_set(links, household) or [household]
        family = families_of[household]
        group, why = _line_group(line, requests, family)
        if group is not None and why == "no_request":
            camper = line.attributed_person_cm_id or line.person_cm_id
            if not any(not camper or not p or p == camper for h in family for p in sessionless.get(h, ())):
                add((pool_of_session(group[1]) or NO_POOL, TOTAL), line)
        elif group is None and asked.isdisjoint(family):
            add((TOTAL,), line)
    return {scope: OffRequestAid(amounts[scope], len(families[scope])) for scope in amounts}
