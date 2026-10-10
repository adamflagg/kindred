"""A frozen season for scenarios (sub-project 9b; spec §7.4: "every scenario runs on the same frozen snapshot of
the season's applications (dated), and never writes live awards").

Freezing (`capture_season`) runs the live season read -- sub-project 10a's FinancialAidDecisionsService.season --
over a recording wrapper of the decisions store, and keeps every value each `fetch_*` returned, plus the grants
register rows it priced with. Pricing a scenario (`price_document`) replays those values into the SAME season read,
with the scenario's document standing in as the approved rules. So a scenario is priced by exactly the code that
prices the live season (price_request, season_budget, holds and all), including anything a later PR adds to that
read, without this module knowing its name: a read the snapshot lacks is refused with "Update Applications again".

The snapshot is JSON: each value goes through a pydantic TypeAdapter for the return type the DecisionsStore
Protocol declares for that read. Nothing here writes; a replayed season can't lock rules sections.

A request intake flagged as waiting for approved programs and cost rules is held by the live read, and so in every
scenario on that snapshot: `awaiting_rules` counts them, so the screen can say "Update Applications again once
the rules are approved" (plan Decision 8). Freezing never refuses for it.

Freezing also records when each frozen request was received (`received`: its create row in aid_change_log, or its
withdrawn predecessor's when the family edited its answer, D138, as bunking.financial_aid.received defines it) and which requests are live, so a scenario can price only the requests
received through a date (`price_document`'s `requests`). That log is read after the season read, so every frozen
request's create row is already there.
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, Final, cast, get_type_hints

from pydantic import TypeAdapter, ValidationError

from api.constants.collections import AID_REQUESTS
from api.services.financial_aid_calc_inputs import awaiting_approved_rules
from api.services.financial_aid_decisions_service import (
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    RegisterSource,
    Season,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_rules_service import RulesVersion
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.decisions import SeasonBudget
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.received import edit_predecessors, received_dates
from bunking.financial_aid.rules import AidRules, SectionName
from bunking.financial_aid.rules.lifecycle import SectionStatus
from bunking.financial_aid.rules.schema import SECTION_NAMES

SNAPSHOT_FORMAT: Final = 1
_REGISTER: Final = TypeAdapter(list[RegisterRow])


class SnapshotError(FinancialAidError, ValueError):
    """A frozen season this code can't replay, or a scenario it can't price on it; the message says what to do."""


@dataclass(frozen=True)
class SeasonSnapshot:
    year: int
    requests: int  # the live requests frozen
    frozen_at: datetime  # the replay's clock
    calls: Mapping[str, Any]  # decisions store read -> what it returned
    register: tuple[RegisterRow, ...]
    awaiting_rules: int = 0  # live requests waiting for approved programs and cost rules: held (Decision 8)
    # request id -> when it was first recorded (its aid_change_log create row); None: no create row (D138)
    received: Mapping[str, datetime | None] = field(default_factory=dict)
    live: frozenset[str] = frozenset()  # the live requests' ids: a request set counts what it leaves out over these


@dataclass(frozen=True)
class PricedSeason:
    season: Season
    budget: SeasonBudget


@functools.cache
def _adapter(name: str) -> TypeAdapter[Any]:
    method = getattr(DecisionsStore, name, None)
    if not name.startswith("fetch_") or method is None:
        raise SnapshotError(
            f"The season read {name}, which the decisions store does not declare: Update Applications again"
        )
    return TypeAdapter(get_type_hints(method)["return"])


def _fresh(value: Any) -> Any:
    """A new container each replay, so no reader can change what the next one sees."""
    if isinstance(value, list):
        return list(value)
    if isinstance(value, dict):
        return dict(value)
    return value


class _Recorder:
    """The decisions store, recording what each read returned."""

    def __init__(self, inner: object) -> None:
        self._inner = inner
        self._started: set[str] = set()
        self.calls: dict[str, Any] = {}

    def __getattr__(self, name: str) -> Any:
        target = getattr(self._inner, name)
        if not name.startswith("fetch_"):
            return target

        async def call(*args: Any, **kwargs: Any) -> Any:
            # The name is reserved BEFORE the await: SP10a's season read runs two branches concurrently, and a
            # second read of the same kind started meanwhile must be refused, not silently overwrite the first.
            if name in self._started:
                raise SnapshotError(f"The season read {name} twice; a snapshot replays each read once")
            self._started.add(name)
            value = await target(*args, **kwargs)
            self.calls[name] = value
            return value

        return call


# The aid_decisions events that post a round or hang off a posted one (the Posted tick, its undo, and the family's
# acceptance of the posted offer). Priced as if nothing is posted, the replay leaves these out, so every round is
# worked out by the document from scratch; the asks, staff awards and approvals are today's data and stay.
_POSTING: Final = frozenset({"post", "unpost", "accept", "unaccept"})


class _Replay:
    """A decisions store that answers each read with what the snapshot recorded. `as_if_unposted` (owner, 2026-10-10:
    next-year modelling on this year's data) answers the decision events with the posting ones left out."""

    def __init__(self, calls: Mapping[str, Any], *, as_if_unposted: bool = False) -> None:
        self._calls = calls
        self._as_if_unposted = as_if_unposted

    def __getattr__(self, name: str) -> Any:
        if name not in self._calls:
            raise SnapshotError(f"This snapshot predates the season read {name}: Update Applications again")
        value = self._calls[name]
        if self._as_if_unposted and name == "fetch_decision_events":
            value = [event for event in value if event.kind not in _POSTING]

        async def call(*args: Any, **kwargs: Any) -> Any:
            return _fresh(value)

        return call


class _Approved:
    """PricingRules answering with the scenario's document, every section approved. It never locks anything."""

    def __init__(self, version: RulesVersion) -> None:
        self._version = version

    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None:
        return self._version

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        return self._version

    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]:
        return dict.fromkeys(ats, self._version), frozenset()

    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]:
        raise SnapshotError("A scenario never writes: nothing locks")


async def capture_season(
    store: DecisionsStore,
    register: RegisterSource,
    rules: PricingRules,
    year: int,
    *,
    clock: Callable[[], datetime] | None = None,
) -> SeasonSnapshot:
    frozen_at = (clock or (lambda: datetime.now(UTC)))()
    recorder = _Recorder(store)
    rows: list[RegisterRow] = []

    async def recorded(season_year: int) -> Sequence[RegisterRow]:
        found = await register(season_year)
        rows.extend(found)
        return found

    # A scenario never writes (spec §7.4): freezing leaves the grant placement log to live pricing (3c-2).
    service = FinancialAidDecisionsService(
        cast(DecisionsStore, recorder), rules, recorded, clock=lambda: frozen_at, log_placements=False
    )
    season = await service.season(year)
    live = frozenset(rid for rid, priced in season.priced.items() if priced.live)
    # Live requests only, by design: a withdrawn request is never priced, so it never waits for rules (Decision 8).
    awaiting = sum(1 for rid in live if awaiting_approved_rules(season.requests[rid]))
    log = await store.fetch_change_log(year, AID_REQUESTS)  # after the season read: every frozen request is logged
    return SeasonSnapshot(
        year=year,
        requests=len(live),
        frozen_at=frozen_at,
        calls=dict(recorder.calls),
        register=tuple(rows),
        awaiting_rules=awaiting,
        received=received_dates(season.requests.keys(), log, predecessors=edit_predecessors(season.requests.values())),
        live=live,
    )


def encode_snapshot(snapshot: SeasonSnapshot) -> dict[str, Any]:
    return {
        "format": SNAPSHOT_FORMAT,
        "year": snapshot.year,
        "requests": snapshot.requests,
        "frozen_at": snapshot.frozen_at.isoformat(),
        "calls": {name: json.loads(_adapter(name).dump_json(value)) for name, value in sorted(snapshot.calls.items())},
        "register": json.loads(_REGISTER.dump_json(list(snapshot.register))),
        "awaiting_rules": snapshot.awaiting_rules,
        "received": {rid: at.isoformat() if at is not None else None for rid, at in sorted(snapshot.received.items())},
        "live": sorted(snapshot.live),
    }


_UNREADABLE: Final = "The frozen season stored for this year can't be read: Update Applications again"


def decode_snapshot(raw: Mapping[str, Any]) -> SeasonSnapshot:
    """A stored snapshot back into a SeasonSnapshot. One this code can't read (a key missing, a value of the wrong
    shape, a read whose type has changed) is a SnapshotError (422) that says to Update Applications again, never a
    500 that locks staff out of Scenarios. Its message never echoes a stored value: the inputs hold families' figures."""
    try:
        if raw.get("format") != SNAPSHOT_FORMAT:
            raise SnapshotError(
                "This snapshot was frozen by an older version of the dashboard: Update Applications again"
            )
        return _decoded(raw)
    except SnapshotError:
        raise
    except (ValidationError, KeyError, TypeError, ValueError, AttributeError) as exc:
        raise SnapshotError(_UNREADABLE) from exc


def _decoded(raw: Mapping[str, Any]) -> SeasonSnapshot:
    calls = {name: _adapter(name).validate_json(json.dumps(value)) for name, value in dict(raw["calls"]).items()}
    return SeasonSnapshot(
        year=int(raw["year"]),
        requests=int(raw["requests"]),
        frozen_at=datetime.fromisoformat(str(raw["frozen_at"])),
        calls=calls,
        register=tuple(_REGISTER.validate_json(json.dumps(raw["register"]))),
        awaiting_rules=int(raw["awaiting_rules"]),
        received={
            rid: datetime.fromisoformat(at) if at is not None else None for rid, at in dict(raw["received"]).items()
        },
        live=frozenset(str(rid) for rid in raw["live"]),
    )


async def price_document(
    snapshot: SeasonSnapshot,
    document: AidRules,
    base: RulesVersion,
    *,
    requests: Collection[str] | None = None,
    as_if_unposted: bool = False,
) -> PricedSeason:
    """`document` priced over the frozen season, as if it were the season's approved rules. `base` is any real
    version of the season (the latest); only its identity fields are kept. `requests` narrows the season to those
    requests before its budget is summed (a request set, D138); None prices every frozen request.

    Regular pricing replays the season as it stands, so a posted round keeps its lock (D43). `as_if_unposted` (owner,
    2026-10-10) replays it with no round posted: every request is priced by `document` from scratch, through the
    same season read, and nothing posted is counted."""
    if document.year != snapshot.year:
        raise SnapshotError(f"The document is for {document.year}, but this snapshot is {snapshot.year}'s")
    approved = {name: SectionStatus(state="approved") for name in SECTION_NAMES}
    version = base.model_copy(update={"document": document, "section_status": approved})

    async def register(year: int) -> Sequence[RegisterRow]:
        return snapshot.register

    service = FinancialAidDecisionsService(
        cast(DecisionsStore, _Replay(snapshot.calls, as_if_unposted=as_if_unposted)),
        _Approved(version),
        register,
        clock=lambda: snapshot.frozen_at,  # the replay runs at the frozen moment
        log_placements=False,  # nor reads or writes the grant placement log (3c-2): a scenario never writes
    )
    season = await service.season(snapshot.year)
    if requests is not None:
        wanted = frozenset(requests)
        season = replace(
            season,
            requests={rid: r for rid, r in season.requests.items() if rid in wanted},
            priced={rid: p for rid, p in season.priced.items() if rid in wanted},
        )
    return PricedSeason(season=season, budget=service.budget_of(season))
