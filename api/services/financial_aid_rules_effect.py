"""A rules approval's effect on the season's pricing (D49; Season › History back-end ask H3).

D49: a rules approval expands to "its effect (re-priced unsent requests)", and amounts are never recomputed
afterwards. Sent offers are never counted: posted rounds are history and carry no "would change" flag (owner
2026-10-05). So the effect is measured once, when the approval commits, and recorded on the approval's own operation
as a log-only aid_change_log row (record_change: a change with no aid_* record write):
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

    def log(self) -> dict[str, int]:
        return {"from_version": self.from_version, "to_version": self.to_version, "repriced": self.repriced}


class ApprovalEffects(Protocol):
    async def measure(self, year: int, before: int, after: int) -> ApprovalEffect: ...


def approval_counts(was: Mapping[str, PricedRequest], now: Mapping[str, PricedRequest]) -> int:
    """Re-priced requests, over live requests (the Owner question), once per request: a round not posted whose decided
    amount differs between the two seasons, in either direction (held becoming priced, or priced becoming held,
    counts). A posted round never counts (owner 2026-10-05: posted rounds are history)."""
    repriced = 0
    for request_id, priced in now.items():
        if not priced.live:
            continue
        before = was.get(request_id)
        moved = False
        for view in priced.rounds:
            old = before.view(view.round) if before is not None else None
            if view.status != "posted" and (old.decided if old is not None else None) != view.decided:
                moved = True
        repriced += moved
    return repriced
