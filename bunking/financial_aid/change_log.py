"""Append-only change history for financial aid (campership spec §14.4).

Every write to decisions, request state, grants, rules, attribution overrides
and session capacity records one ``aid_change_log`` row through
``record_change``: who, when, what, from what, to what, and why. A business
record, not an access log.

Synchronous because the PocketBase SDK is. Async FastAPI services call it as
``await asyncio.to_thread(record_change, pb, entity=..., ...)``, the way they
call every other SDK method. It raises on bad input and lets any SDK error
propagate: a change that could not be recorded must not look recorded.

Snapshots are stored as JSON. ``Decimal`` becomes its exact string (money is
Decimal throughout the calculator, spec §8), dates and datetimes become ISO
8601, NaN and infinity are refused, keys must be text at every depth, and anything else JSON cannot hold raises
``TypeError`` naming the type.
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any

from pocketbase import PocketBase

COLLECTION = "aid_change_log"

_MIN_YEAR = 2000
_MAX_YEAR = 2100


def _json_default(value: object) -> str:
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError(f"aid_change_log cannot store a non-finite Decimal ({value!s}); refuse the write")
        return str(value)
    if isinstance(value, date):  # datetime is a date subclass
        return value.isoformat()
    raise TypeError(f"aid_change_log cannot store a {type(value).__name__}; convert it before recording")


def _require_string_keys(value: object, label: str) -> None:
    # json.dumps would silently turn 1 into "1", and {1: a, "1": b} into one key.
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{label} has a {type(key).__name__} key ({key!r}); snapshot keys must be text")
            _require_string_keys(item, label)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _require_string_keys(item, label)


def _snapshot(value: dict[str, Any] | None, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise TypeError(f"{label} must be a dict or None, got {type(value).__name__}")
    _require_string_keys(value, label)
    encoded = json.dumps(value, default=_json_default, allow_nan=False)
    decoded: dict[str, Any] = json.loads(encoded)
    return decoded


def _required_text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required and must be non-blank text")
    return value.strip()


def record_change(
    pb: PocketBase,
    *,
    entity: str,
    entity_id: str,
    year: int,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    actor: str,
    reason: str | None,
) -> None:
    """Append one row to ``aid_change_log``.

    ``entity`` names the collection or concept changed (for example
    ``"aid_decisions"``); ``entity_id`` its key as text; ``year`` the season;
    ``action`` a short verb (``"create"``, ``"update"``, ``"delete"``,
    ``"approve"``...); ``actor`` the staff user's id or email. ``before`` and
    ``after`` may not both be None. For ``action == "create"``, ``before``
    must be None; for ``action == "delete"``, ``after`` must be None. Other
    actions may carry either or both snapshots.
    """
    if isinstance(year, bool) or not isinstance(year, int):
        raise TypeError(f"year must be an int season, got {type(year).__name__}")
    if not _MIN_YEAR <= year <= _MAX_YEAR:
        raise ValueError(f"year {year} is outside {_MIN_YEAR}-{_MAX_YEAR}")
    body = {
        "entity": _required_text(entity, "entity"),
        "entity_id": _required_text(entity_id, "entity_id"),
        "year": year,
        "action": _required_text(action, "action"),
        "before": _snapshot(before, "before"),
        "after": _snapshot(after, "after"),
        "actor": _required_text(actor, "actor"),
        "reason": (reason or "").strip(),
    }
    if body["before"] is None and body["after"] is None:
        raise ValueError("a change needs a before or an after snapshot")
    if body["action"] == "create" and body["before"] is not None:
        raise ValueError("a create change must not carry a before snapshot")
    if body["action"] == "delete" and body["after"] is not None:
        raise ValueError("a delete change must not carry an after snapshot")
    pb.collection(COLLECTION).create(body)
