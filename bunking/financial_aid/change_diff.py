"""The readable diff behind ``aid_change_log`` (campership spec §14.4).

A log row holds "before and after, holding only the changed fields", and a
screen renders it as a field-level diff ("Round 1 %, tier 3: 74.5 -> 72").
Pure functions over plain dicts:

- ``changed_fields(before, after)`` keeps only what changed, recursing into
  nested dicts (rules documents are nested: a tier table keyed by tier) and
  comparing lists whole. A key only in ``after`` was added and appears only on
  the after side; a key only in ``before`` was removed and appears only on the
  before side. A key present with ``None`` is not the same as an absent key.
- ``field_changes(before, after)`` lists each changed leaf with its path, for
  rendering. It reads stored rows back too, since a stored row already holds
  only the changed fields.

**Equality, chosen deliberately** (``values_equal``):

- numbers (``int``, ``float``, ``Decimal``; never ``bool``) are equal when their
  values are equal, so a float PocketBase returns (1250.5) equals the
  calculator's ``Decimal("1250.50")``, and ``Decimal("72")`` equals
  ``Decimal("72.00")``. A float is compared through its shortest repr, so
  ``0.1`` equals ``Decimal("0.1")``;
- otherwise two values are equal when ``aid_change_log`` would store them
  identically: ``Decimal("74.5")`` equals ``"74.5"`` (a Decimal is stored as its
  exact string) and ``date(2027, 3, 1)`` equals ``"2027-03-01"``. A string is
  never parsed, so ``Decimal("72")`` and ``"72.0"`` differ;
- a ``bool`` is never equal to a number (``True`` is not ``1``).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal

ChangeKind = Literal["added", "removed", "changed"]


@dataclass(frozen=True)
class FieldChange:
    """One changed leaf. ``before``/``after`` is None on the missing side of an add or remove."""

    path: tuple[str, ...]
    kind: ChangeKind
    before: Any
    after: Any

    @property
    def dotted(self) -> str:
        """The path joined with dots, for display ("tiers.3.round1_pct")."""
        return ".".join(self.path)


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)


def _as_decimal(value: int | float | Decimal) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(repr(value) if isinstance(value, float) else value)


def _stored_form(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, date):  # datetime is a date subclass
        return value.isoformat()
    return value


def values_equal(a: object, b: object) -> bool:
    """True when a change from ``a`` to ``b`` is not a change (see the module docstring)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_number(a) and _is_number(b):
        left, right = _as_decimal(a), _as_decimal(b)  # type: ignore[arg-type]
        if left.is_nan() or right.is_nan():
            return False
        return left == right
    if isinstance(a, Mapping) and isinstance(b, Mapping):
        return a.keys() == b.keys() and all(values_equal(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(values_equal(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, (Mapping, list, tuple)) or isinstance(b, (Mapping, list, tuple)):
        return False
    return _stored_form(a) == _stored_form(b)


def _copy(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {k: _copy(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_copy(v) for v in value]
    return value


def changed_fields(
    before: Mapping[str, Any] | None, after: Mapping[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return ``(before, after)`` holding only the changed fields. Inputs are not mutated."""
    old: Mapping[str, Any] = before or {}
    new: Mapping[str, Any] = after or {}
    kept_before: dict[str, Any] = {}
    kept_after: dict[str, Any] = {}
    for key in old:
        if key not in new:
            kept_before[key] = _copy(old[key])
    for key in new:
        if key not in old:
            kept_after[key] = _copy(new[key])
            continue
        was, now = old[key], new[key]
        if isinstance(was, Mapping) and isinstance(now, Mapping):
            inner_before, inner_after = changed_fields(was, now)
            if inner_before or inner_after:
                kept_before[key] = inner_before
                kept_after[key] = inner_after
        elif not values_equal(was, now):
            kept_before[key] = _copy(was)
            kept_after[key] = _copy(now)
    return kept_before, kept_after


def _leaves(value: Mapping[str, Any], prefix: tuple[str, ...]) -> list[tuple[tuple[str, ...], Any]]:
    out: list[tuple[tuple[str, ...], Any]] = []
    for key, item in value.items():
        if isinstance(item, Mapping) and item:
            out.extend(_leaves(item, (*prefix, key)))
        else:
            out.append(((*prefix, key), item))
    return out


def field_changes(before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> list[FieldChange]:
    """Each changed leaf with its path, sorted by path.

    An added or removed nested dict is listed leaf by leaf, so every entry is
    one renderable line.
    """
    old: Mapping[str, Any] = before or {}
    new: Mapping[str, Any] = after or {}
    changes: list[FieldChange] = []
    for key in old.keys() | new.keys():
        if key not in new:
            changes.extend(FieldChange(p, "removed", v, None) for p, v in _leaves({key: old[key]}, ()))
        elif key not in old:
            changes.extend(FieldChange(p, "added", None, v) for p, v in _leaves({key: new[key]}, ()))
        elif isinstance(old[key], Mapping) and isinstance(new[key], Mapping):
            changes.extend(
                FieldChange((key, *c.path), c.kind, c.before, c.after) for c in field_changes(old[key], new[key])
            )
        elif not values_equal(old[key], new[key]):
            changes.append(FieldChange((key,), "changed", old[key], new[key]))
    return sorted(changes, key=lambda c: c.path)
