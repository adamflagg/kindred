"""A rules approval's effect on the season's pricing (D49; Season › History back-end ask H3).

D49: a rules approval expands to "its effect (re-priced unsent requests, 'would change' flags on sent offers)", and
amounts are never recomputed afterwards. So the effect is measured once, when the approval commits, and recorded on
the approval's own operation as a log-only aid_change_log row (record_change: a change with no aid_* record write):
entity RULES_EFFECT_ENTITY, action EFFECT_ACTION. History classes that entity as rules, so only financial_aid.rules
readers ever see it. The rules log the replay reads (entity aid_rules exactly) never holds it.

Pure: the counts compare two priced seasons. The pricing that produces them is financial_aid_rules_effect_pricing."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, Protocol

from bunking.financial_aid.decisions import PricedRequest

RULES_EFFECT_ENTITY: Final = "aid_rules_effect"
EFFECT_ACTION: Final = "effect"


@dataclass(frozen=True)
class ApprovalEffect:
    from_version: int  # the version pricing the season before the approval; 0: none
    to_version: int  # after it; equal to from_version when the approval moved no pricing
    repriced: int
    flagged: int

    def log(self) -> dict[str, int]:
        return {
            "from_version": self.from_version,
            "to_version": self.to_version,
            "repriced": self.repriced,
            "flagged": self.flagged,
        }


class ApprovalEffects(Protocol):
    async def measure(self, year: int, before: int, after: int) -> ApprovalEffect: ...


def approval_counts(was: Mapping[str, PricedRequest], now: Mapping[str, PricedRequest]) -> tuple[int, int]:
    """(re-priced requests, flagged offers), over live requests (the Owner question).

    Re-priced, once per request: a round not posted whose decided amount differs between the two seasons, in either
    direction (held becoming priced, or priced becoming held, counts). Flagged, once per sent offer (a posted round,
    not clawed back): its "would change by" is non-zero now and differs from before (D43/D152: the offer stands, the
    flag is information). A flag that clears is not counted. So "12 sent offers flagged" counts offers, D49's noun."""
    repriced = flagged = 0
    for request_id, priced in now.items():
        if not priced.live:
            continue
        before = was.get(request_id)
        moved = False
        for view in priced.rounds:
            old = before.view(view.round) if before is not None else None
            if view.status == "posted":
                change = view.would_change_by
                if not view.clawed_back and change is not None and change != 0:
                    flagged += old is None or old.would_change_by != change
            elif (old.decided if old is not None else None) != view.decided:
                moved = True
        repriced += moved
    return repriced, flagged
