"""Hold releases and manual holds (campership follow-up 3b; app spec §4.4, §4.6, §6.3; main spec
§10.2, §10.5, §14.4; D15).

A failed check holds the award until someone releases it with a note (main spec §10.5). "Waiting on
something" is a hold with a reason, not a stage (§10.2): staff place it by hand ("Put on hold…",
app spec §6.3). Both are request-level, like the holds sub-project 10a's pricing reads
(`RequestToPrice.released_holds`): a hold stops every round not yet posted, and never touches a
posted one.

aid_hold_events is append-only (pocketbase/pb_migrations/1500000212_aid_hold_events.js). Each row is
one dated event on one request:

  release / unrelease   a check's hold released with a note, or put back (`code` = the check's code);
  place / lift          the request's manual hold placed with its reason, or lifted (`code` = manual_hold).

A request's hold state is the fold of its events in the order they were recorded, so its state on
any past date is the fold of the events recorded by then: pass `as_of` (the as-of reads, 3c).

Some holds clear only when their cause is fixed, and no release lifts them (UNRELEASABLE). The fold
enforces it too: a release of one of them, however it was written, never reaches pricing.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Final, Literal, get_args

from bunking.financial_aid.calculator import CalcIssue
from bunking.financial_aid.decisions.pricing import NO_APPROVED_RULES, RequestToPrice

HoldEventKind = Literal["release", "unrelease", "place", "lift"]
HOLD_EVENT_KINDS: Final[tuple[HoldEventKind, ...]] = get_args(HoldEventKind)
MANUAL_HOLD: Final = "manual_hold"

# Holds that clear only when their cause is fixed, and how each one clears (shown to staff when a
# release is refused). The always-holds can't be made warnings (main spec §10.5); these can't be
# released either. duplicate_survivor_withdrawn is releasable on purpose: its only resolution is a
# person checking the old request's shares and decisions.
UNRELEASABLE: Final[Mapping[str, str]] = {
    "award_above_cost": ("aid plus outside grants is never above cost: correct the cost, the grants or the amount"),
    "household_income_conflict": "enter the income figure to use as a correction, and it clears",
    "payer_shares_incomplete": "set the payer shares to add up to 100%, and it clears",
    "awaiting_approved_rules": "it clears when finance approves the season's rules and intake runs",
    "unmatched_session": "resolve the session, and it clears",
    "session_not_running": (
        "cancel the request, move it to a running session, or mark the session running again in Rules"
    ),
    NO_APPROVED_RULES: "it clears when finance approves the season's pricing rules",
    "not_priceable": "it clears when the request can be priced",
    MANUAL_HOLD: "lift the manual hold instead",
}


@dataclass(frozen=True)
class HoldEvent:
    """One aid_hold_events row. `created` is when staff did it (a hold is an act in Kindred). `fact`
    is what a release was released against (Decision 3); nothing compares it yet."""

    id: str
    request_id: str
    kind: HoldEventKind
    code: str
    created: datetime
    note: str = ""
    actor: str = ""
    fact: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class HoldRelease:
    code: str
    note: str
    released_at: datetime
    released_by: str
    fact: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class ManualHold:
    reason: str
    placed_at: datetime
    placed_by: str


@dataclass(frozen=True)
class HoldState:
    """One request's holds as its events leave them: the check codes released, and the manual hold."""

    released: Mapping[str, HoldRelease] = field(default_factory=dict)
    manual: ManualHold | None = None

    def released_codes(self) -> frozenset[str]:
        """What pricing may lift: every released code except those that clear only when fixed.

        The filter is today's UNRELEASABLE, so an as-of fold (3c) applies today's set to past dates
        too: a later change to the set changes the rebuilt past."""
        return frozenset(code for code in self.released if code not in UNRELEASABLE)

    def manual_issue(self) -> CalcIssue | None:
        if self.manual is None:
            return None
        return CalcIssue(code=MANUAL_HOLD, severity="hold", message=self.manual.reason, step="casework")


# Codes the calculator never raises as a hold (calculator/engine.py; the quality checks and the intake
# checks are hold or warn only): each is needs_input or error, except that cost_unknown is a warn
# when the rules price an unknown cost at the minimum award. As needs_input or error the request
# can't be priced and no release lifts it; as a warn it is a note, with nothing to release. Either
# way a release row written for one is not a standing hold release.
NEVER_A_HOLD: Final[frozenset[str]] = frozenset(
    {
        "income_missing",
        "income_below_first_band",
        "cost_unknown",
        "ask_missing",
        "no_round1_table",
        "no_equity_class",
        "unknown_program",
        "program_closed",
        "unknown_decision_type",
        "rules_error",
    }
)

NO_HOLDS: Final = HoldState()


def apply_hold_event(state: HoldState, event: HoldEvent) -> HoldState:
    if event.kind == "release":
        release = HoldRelease(
            code=event.code, note=event.note, released_at=event.created, released_by=event.actor, fact=event.fact
        )
        return replace(state, released={**state.released, event.code: release})
    if event.kind == "unrelease":
        return replace(state, released={code: r for code, r in state.released.items() if code != event.code})
    if event.kind == "place":
        return replace(state, manual=ManualHold(reason=event.note, placed_at=event.created, placed_by=event.actor))
    if event.kind == "lift":
        return replace(state, manual=None)
    raise ValueError(f"unknown aid_hold_events event {event.kind!r}")


def fold_holds(events: Iterable[HoldEvent], *, as_of: datetime | None = None) -> dict[str, HoldState]:
    """request id -> hold state, from the events recorded up to `as_of` (every event when None).
    Events apply in the order they were recorded; the record id breaks a tie in the same instant."""
    out: dict[str, HoldState] = {}
    kept = (e for e in events if as_of is None or e.created <= as_of)
    for event in sorted(kept, key=lambda e: (e.created, e.id)):
        out[event.request_id] = apply_hold_event(out.get(event.request_id, NO_HOLDS), event)
    return out


def releasable(issue: CalcIssue) -> bool:
    """Whether a release can lift this issue: a hold, and not one that clears only when fixed. A
    needs_input or error result means the request can't be priced, which no release changes."""
    return issue.severity == "hold" and issue.code not in UNRELEASABLE


def with_holds(item: RequestToPrice, state: HoldState) -> RequestToPrice:
    """The request as pricing should see it: its released check codes, and its manual hold as a hold."""
    manual = state.manual_issue()
    return replace(
        item,
        issues=(*item.issues, manual) if manual is not None else item.issues,
        released_holds=state.released_codes(),
    )
