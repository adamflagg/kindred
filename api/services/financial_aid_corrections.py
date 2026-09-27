"""Staff corrections to intake values: a layer over synced data (spec 3.3, 9.3).

Synced FA answers are never edited. A correction row records the field, the
new value, the value it replaced, the reason, who and when. The newest row for
a field wins, and an empty `new_value` reverts to the synced value. The
calculator reads `effective`; the screen shows `synced`, `effective` and the
history.

Every numeric and yes/no financial field is correctable (spec 2 item 22),
each with a kind that fixes how its value is parsed and stored. Free-text
answers are shown, not corrected. Values are canonical strings ("85000.00",
"3", "true") so money never passes through a float on the way to the
calculator. A BLANK synced value is "" (unknown, spec principle 5), never
"0.00"; a correction of 0 is a confirmed zero.

`income_override` is SP3's IncomeOverride carried as a correction, so it has a
reason, history and a change-log row: "prior_year_only", "current_year_only",
"confirmed_prior_year" or "staff_entered:<amount>" (an income staff took by
phone, which is how an adult with no income answers can be priced).

`changed_since_correction` says the synced value moved after staff corrected
it (the family edited the form), which staff should look at again.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Final

from api.services.financial_aid_household import BOOL_FIELDS, INCOME_FIELDS, NUMBER_FIELDS
from api.services.financial_aid_intake_types import CorrectionRecord


class FieldKind(StrEnum):
    MONEY = "money"
    COUNT = "count"
    FLAG = "flag"
    INCOME_OVERRIDE = "income_override"


INCOME_OVERRIDE_FIELD: Final = "income_override"
_COUNT_FIELDS: Final = frozenset({"num_children"})

APPLICATION_CORRECTABLE: Final[Mapping[str, FieldKind]] = MappingProxyType(
    {
        **dict.fromkeys(INCOME_FIELDS, FieldKind.MONEY),
        **{name: FieldKind.COUNT if name in _COUNT_FIELDS else FieldKind.MONEY for name in NUMBER_FIELDS},
        **dict.fromkeys(BOOL_FIELDS, FieldKind.FLAG),
        INCOME_OVERRIDE_FIELD: FieldKind.INCOME_OVERRIDE,
    }
)
REQUEST_CORRECTABLE: Final[Mapping[str, FieldKind]] = MappingProxyType({"ask": FieldKind.MONEY})

REVERT: Final = ""
_CENT: Final = Decimal("0.01")
MONEY_CEILING: Final = Decimal(10000000)
COUNT_CEILING: Final = 50
# SP3's IncomeOverride modes (bunking/financial_aid/calculator/inputs.py). Only staff_entered carries an amount.
OVERRIDE_MODES: Final = frozenset({"prior_year_only", "current_year_only", "confirmed_prior_year"})
STAFF_ENTERED: Final = "staff_entered"


class CorrectionError(ValueError):
    """A correction that cannot be stored; the message is safe to show staff."""


def canonical_synced(kind: FieldKind, value: Any) -> str:
    if kind is FieldKind.FLAG:
        return "true" if bool(value) else "false"
    if value is None or value == "":
        return ""  # blank: unknown, never 0 (spec principle 5)
    if kind is FieldKind.INCOME_OVERRIDE:
        return str(value)
    if kind is FieldKind.COUNT:
        return str(int(float(value)))
    return f"{Decimal(str(value)).quantize(_CENT, rounding=ROUND_HALF_UP)}"


def _money(text: str) -> str:
    try:
        amount = Decimal(text.replace(",", "").removeprefix("$"))
    except InvalidOperation as exc:
        raise CorrectionError("expected a dollar amount") from exc
    if not amount.is_finite() or amount < 0 or amount > MONEY_CEILING:
        raise CorrectionError("amount out of range")
    if amount != amount.quantize(_CENT):
        raise CorrectionError("at most two decimal places")
    return f"{amount.quantize(_CENT)}"


def _income_override(text: str) -> str:
    mode, _, amount = text.partition(":")
    mode = mode.strip()
    if mode in OVERRIDE_MODES and not amount:
        return mode
    if mode == STAFF_ENTERED and amount.strip():
        return f"{STAFF_ENTERED}:{_money(amount.strip())}"
    raise CorrectionError("expected prior_year_only, current_year_only, confirmed_prior_year or staff_entered:<amount>")


def parse_new_value(kind: FieldKind, raw: str | None) -> str:
    if raw is None:
        return REVERT
    text = raw.strip()
    if kind is FieldKind.INCOME_OVERRIDE:
        return _income_override(text)
    if kind is FieldKind.FLAG:
        folded = text.casefold()
        if folded in {"true", "yes"}:
            return "true"
        if folded in {"false", "no"}:
            return "false"
        raise CorrectionError("expected true or false")
    if kind is FieldKind.COUNT:
        # isdecimal(), not isdigit(): isdigit() also accepts superscript/subscript digits
        # ("³") that int() then rejects with a bare ValueError -- not a CorrectionError,
        # so it would reach the router's exception handling unmapped and surface as a 500.
        if not text.isdecimal():
            raise CorrectionError("expected a whole number")
        count = int(text)
        if count > COUNT_CEILING:
            raise CorrectionError(f"expected at most {COUNT_CEILING}")
        return str(count)
    return _money(text)


@dataclass(frozen=True)
class EffectiveValue:
    field: str
    synced: str
    effective: str
    corrected: bool
    changed_since_correction: bool
    history: tuple[CorrectionRecord, ...]


def effective_values(
    synced: Mapping[str, Any],
    kinds: Mapping[str, FieldKind],
    corrections: Sequence[CorrectionRecord],
    request_id: str = "",
) -> dict[str, EffectiveValue]:
    result: dict[str, EffectiveValue] = {}
    for name, kind in kinds.items():
        base = canonical_synced(kind, synced.get(name))
        history = tuple(
            sorted(
                (c for c in corrections if c.field == name and c.request_id == request_id),
                key=lambda c: (c.created, c.id),
            )
        )
        latest = history[-1] if history else None
        if latest is not None and latest.new_value != REVERT:
            result[name] = EffectiveValue(name, base, latest.new_value, True, latest.original_value != base, history)
        else:
            result[name] = EffectiveValue(name, base, base, False, False, history)
    return result
