"""Season › History's response models (D49, app spec §7.6): the season's change log, one line per operation, and one
operation expanded to its rows and their field-level diffs. Amounts are what the rows recorded, never recomputed."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from api.schemas.financial_aid_rules import FieldChangeOut

HistoryKind = Literal["rules", "offers", "money", "holds", "grants", "intake"]


class HistoryCountOut(BaseModel):
    entity: str  # the aid_* collection
    action: str  # the logged action ("post", "approve", "save", "update", ...)
    rows: int


class HistoryFiguresOut(BaseModel):
    """What an operation's rows add up to, as recorded (D49; back-end ask H1). Each money figure keeps its basis and
    none is added to another (D20). None: the operation has no row of that kind; 0 is a real zero (D74)."""

    requests: int  # the distinct requests its rows name
    families: int  # the distinct households those rows are about
    locked: float | None  # its Posted ticks: the sum of the amounts they locked (D51, D52)
    round3_entered: float | None  # its Round 3 amounts entered: Decided, maybe pending approval, never "awarded" (D80)
    asked: float | None  # its asks entered: what the family asked for, not aid


class HistoryEffectOut(BaseModel):
    """A rules approval's effect on the season's pricing, as recorded when it was approved (H3; D49)."""

    from_version: int | None  # the rules version pricing the season before; None: none did
    to_version: int | None  # the one pricing it after; equal to from_version when the approval moved no pricing
    repriced: int  # live requests with an unsent round whose decided amount moved
    # Never emitted since 2026-10-05 (owner: posted rounds are history, so no sent offer is flagged): always 0, and an
    # older row's "flagged" is ignored. The field is removed after slice 1 lands.
    flagged: int = 0


class HistoryOperationOut(BaseModel):
    operation_id: str
    at: datetime  # when its last row was recorded
    actor: str  # the signed-in person, or system:intake / system:ledger / system:grant-placement
    kind: HistoryKind
    reason: str  # the first non-empty reason among its rows
    rows: int
    counts: list[HistoryCountOut]  # by entity, then action
    rules_versions: list[int]  # the rules versions it touched ("Open vN in Rules")
    rules_sections: list[str]  # the rules sections it approved or locked
    # "7 requests · 6 families · $9,840 locked", then a rules approval's effect words when it has one
    # ("v4 now prices the season · 41 unsent requests re-priced"); "" when it has neither
    summary: str
    figures: HistoryFiguresOut
    effect: HistoryEffectOut | None  # a rules approval's recorded effect; None on every other line


class HistoryKindCountOut(BaseModel):
    kind: HistoryKind
    operations: int  # what `total` would be with this chip alone picked, every other filter kept (H5)


class HistoryPageOut(BaseModel):
    year: int
    page: int
    per_page: int
    total: int  # operations matching the filters
    operations: list[HistoryOperationOut]  # newest first
    actors: list[str]  # everyone with an operation this reader can see: the person filter's choices
    kind_counts: list[HistoryKindCountOut]  # the reader's chips, in the mock's order; Rules only with rules


class HistoryParentDiffOut(BaseModel):
    """A created rules version against the version it was copied from (H4), as that version is stored."""

    year: int  # the parent's season (last season's for "Start from last year")
    version: int
    changes: list[FieldChangeOut]  # paths start ["document", <section>, ...] or ["section_status", <section>, ...]


class HistoryRowOut(BaseModel):
    at: datetime
    entity: str
    entity_id: str
    action: str
    actor: str
    reason: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    changes: list[FieldChangeOut]  # the field-level diff ("Round 1 %, tier 3: 74.5 -> 72")
    household_cm_id: int | None  # the household the row is about (H2); None when it names none (rules, grantors, ...)
    household_name: str | None  # None when the household has no record this season (the grid would say "Household N")
    camper_name: str | None  # None for a family-level row (an application, a household's own request)
    against_parent: HistoryParentDiffOut | None  # only on a row that created a rules version with a parent (H4)


class HistoryOperationDetailOut(BaseModel):
    year: int
    operation: HistoryOperationOut
    rows: list[HistoryRowOut]  # in recorded order
