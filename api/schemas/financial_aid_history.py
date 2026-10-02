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


class HistoryPageOut(BaseModel):
    year: int
    page: int
    per_page: int
    total: int  # operations matching the filters
    operations: list[HistoryOperationOut]  # newest first
    actors: list[str]  # everyone with an operation this reader can see: the person filter's choices


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


class HistoryOperationDetailOut(BaseModel):
    year: int
    operation: HistoryOperationOut
    rows: list[HistoryRowOut]  # in recorded order
