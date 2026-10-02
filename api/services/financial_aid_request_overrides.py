"""Staff overrides on one request (D22; main spec §10.2: "include is derived … with an audited override"): a cost
override with its reason code, and the Include override. Each is an aid_application_corrections row on the request,
as the household's income override is (financial_aid_corrections), so it carries a reason, a history and a change-log
row, and a past date replays it by its created time. The newest row for a field wins; an empty value reverts it.

Only the decisions service's two writes create these rows (they check the reason code and skip a no-op); the generic
corrections route refuses both fields (REQUEST_CORRECTABLE holds only the ask)."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal, InvalidOperation
from typing import Final

from pydantic import ValidationError

from api.constants.collections import AID_APPLICATION_CORRECTIONS
from api.services.financial_aid_intake_types import CorrectionRecord, RequestRecord
from bunking.financial_aid.calculator import CostOverride
from bunking.financial_aid.change_log import AidWrite
from bunking.financial_aid.rules.schema import CostSection

COST_OVERRIDE: Final = "cost_override"
INCLUDE_OVERRIDE: Final = "include_override"
EXCLUDED: Final = "excluded"  # the Include override's one value: staff left the request out (Decision 5)
# The reason codes a season without approved rules offers (Decision 6): the rules' own defaults.
DEFAULT_REASON_CODES: Final[tuple[str, ...]] = tuple(CostSection().override_reasons)
_CENT: Final = Decimal("0.01")


def encode_cost_override(reason_code: str, amount: Decimal) -> str:
    """ "<reason code>:<amount to the cent>", as the income override's "staff_entered:<amount>"."""
    return f"{reason_code}:{amount.quantize(_CENT)}"


def parse_cost_override(value: str) -> CostOverride | None:
    code, sep, amount = value.partition(":")
    if not sep or not code:
        return None
    try:
        return CostOverride(amount=Decimal(amount), reason=code)
    except InvalidOperation, ValidationError:
        return None


def latest(corrections: Iterable[CorrectionRecord], request_id: str, field: str) -> CorrectionRecord | None:
    """The request's newest row for `field` (by created, then id, as effective_values orders corrections)."""
    rows = [c for c in corrections if c.request_id == request_id and c.field == field]
    return max(rows, key=lambda c: (c.created, c.id), default=None)


def cost_override(request_id: str, corrections: Iterable[CorrectionRecord]) -> CostOverride | None:
    row = latest(corrections, request_id, COST_OVERRIDE)
    return parse_cost_override(row.new_value) if row is not None and row.new_value else None


def exclusion(request_id: str, corrections: Iterable[CorrectionRecord]) -> CorrectionRecord | None:
    row = latest(corrections, request_id, INCLUDE_OVERRIDE)
    return row if row is not None and row.new_value == EXCLUDED else None


def by_request(
    corrections: Iterable[CorrectionRecord],
) -> tuple[dict[str, CorrectionRecord], dict[str, CorrectionRecord]]:
    """Each request's standing cost-override row and its standing exclusion row (a reverted one stands as nothing)."""
    rows = list(corrections)
    ids = {c.request_id for c in rows if c.request_id and c.field in (COST_OVERRIDE, INCLUDE_OVERRIDE)}
    costs: dict[str, CorrectionRecord] = {}
    exclusions: dict[str, CorrectionRecord] = {}
    for rid in ids:
        row = latest(rows, rid, COST_OVERRIDE)
        if row is not None and parse_cost_override(row.new_value) is not None:
            costs[rid] = row
        excluded = exclusion(rid, rows)
        if excluded is not None:
            exclusions[rid] = excluded
    return costs, exclusions


def override_write(request: RequestRecord, field: str, value: str, actor: str, note: str) -> AidWrite:
    """One aid_application_corrections row and its log line. The log keys it `<request>:<field>`, so the household
    page's timeline (which follows the page's request ids) shows it."""
    data = {
        "year": request.year,
        "application": request.application_id,
        "request": request.id,
        "field": field,
        "new_value": value,
        "original_value": "",
        "reason": note,
        "actor": actor,
    }
    return AidWrite(
        collection=AID_APPLICATION_CORRECTIONS,
        action="create",
        year=request.year,
        data=data,
        after={"field": field, "value": value},
        log_action=field,
        entity_id=f"{request.id}:{field}",
    )
