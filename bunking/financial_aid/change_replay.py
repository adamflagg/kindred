"""A record's fields as of a past instant, replayed from aid_change_log (campership 3c; spec §14.4).

Every write to an aid_* collection logs one row in the same batch (sub-project 4a). A create's
`after` is the whole record. An update's `before` and `after` hold only the changed fields
(change_diff.changed_fields: nested dicts recurse; a key only in `before` was removed). A delete's
`before` is the record. Replaying a record's rows in recorded order rebuilds it at any instant.

Two rows of one record can share an instant: one operation can write a request twice (intake's
session-swap cycle-breaker vacates a slot, then fills its final session), and `created` is
millisecond-grained. Their order inside the instant is unknown. Where they change the same field,
the value is taken from what followed: the next row touching that field logged it as its
`before`, or, with none, the record as it stands now (`current`). With neither, the record is
`complete=False` from that instant on. Nothing is guessed.
"""

from __future__ import annotations

import copy
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from itertools import groupby
from typing import Any, Final, Literal

from bunking.financial_aid.change_diff import field_changes

RowKind = Literal["create", "update", "delete"]
Path = tuple[str, ...]


class _Mark:
    def __init__(self, name: str) -> None:
        self.name = name


_MISSING: Final = _Mark("missing")  # the field is absent
_UNSETTLED: Final = _Mark("unsettled")  # no later row touched it
_AMBIGUOUS: Final = _Mark("ambiguous")  # a later row touched it in a way that can't settle it


@dataclass(frozen=True)
class LogRow:
    id: str
    entity: str
    entity_id: str
    before: Mapping[str, Any] | None
    after: Mapping[str, Any] | None
    created: datetime

    @property
    def kind(self) -> RowKind:
        if self.before is None:
            return "create"
        return "delete" if self.after is None else "update"

    def paths(self) -> frozenset[Path]:
        return frozenset(change.path for change in field_changes(self.before, self.after))


@dataclass(frozen=True)
class Replayed:
    state: dict[str, Any] | None  # None: deleted by then
    complete: bool  # the history began with its create, and every same-instant clash was settled
    created: datetime  # the first row's instant


def apply_change(state: Mapping[str, Any], before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, Any]:
    """One update's changed-fields diff applied to `state`."""
    out = dict(state)
    for key, new in after.items():
        old, here = before.get(key), out.get(key)
        if key in before and isinstance(new, Mapping) and isinstance(old, Mapping) and isinstance(here, Mapping):
            out[key] = apply_change(here, old, new)
        else:
            out[key] = copy.deepcopy(new)
    for key in before:
        if key not in after:
            out.pop(key, None)
    return out


def _related(a: Path, b: Path) -> bool:
    shorter = min(len(a), len(b))
    return a[:shorter] == b[:shorter]


def _get(state: Mapping[str, Any], path: Path) -> Any:
    node: Any = state
    for part in path:
        if not isinstance(node, Mapping) or part not in node:
            return _MISSING
        node = node[part]
    return copy.deepcopy(node)


def _put(state: dict[str, Any], path: Path, value: Any) -> None:
    node = state
    for part in path[:-1]:
        node = node.setdefault(part, {})
    if value is _MISSING:
        node.pop(path[-1], None)
    else:
        node[path[-1]] = value


def _clash(group: Sequence[LogRow]) -> frozenset[Path]:
    """The fields two same-instant updates both changed."""
    clashing: set[Path] = set()
    updates = [row for row in group if row.kind == "update"]
    for i, row in enumerate(updates):
        for other in updates[i + 1 :]:
            clashing |= {p for p in row.paths() for q in other.paths() if _related(p, q)}
    return frozenset(clashing)


def _from_later(path: Path, later: Sequence[LogRow]) -> Any:
    for row in later:
        if row.kind == "create":
            return _AMBIGUOUS
        for change in field_changes(row.before, row.after):
            if change.path == path:
                return _MISSING if change.kind == "added" else copy.deepcopy(change.before)
            if _related(change.path, path):
                return _AMBIGUOUS
    return _UNSETTLED


def _settle(paths: frozenset[Path], later: Sequence[LogRow], now: Mapping[str, Any] | None) -> dict[Path, Any] | None:
    out: dict[Path, Any] = {}
    for path in paths:
        value = _from_later(path, later)
        if value is _UNSETTLED:
            if now is None:
                return None
            value = _get(now, path)
        if value is _AMBIGUOUS:
            return None
        out[path] = value
    return out


def _order(row: LogRow) -> tuple[datetime, bool, str]:
    return (row.created, row.kind != "create", row.id)


def _replay_one(history: Sequence[LogRow], as_of: datetime | None, now: Mapping[str, Any] | None) -> Replayed | None:
    kept = [row for row in history if as_of is None or row.created <= as_of]
    if not kept:
        return None
    state: dict[str, Any] | None = None
    complete = kept[0].kind == "create"
    for instant, grouped in groupby(kept, key=lambda row: row.created):
        group = list(grouped)
        if len(group) > 1 and any(row.kind == "delete" for row in group):
            complete = False
        clash = _clash(group)
        for row in group:
            if row.kind == "create":
                state = copy.deepcopy(dict(row.after or {}))
            elif row.kind == "delete":
                state = None
            else:
                if state is None:
                    complete = False
                state = apply_change(state or {}, row.before or {}, row.after or {})
        if clash:
            settled = _settle(clash, [row for row in history if row.created > instant], now)
            if settled is None or state is None:
                complete = False
            else:
                for path, value in settled.items():
                    _put(state, path, value)
    return Replayed(state=state, complete=complete, created=kept[0].created)


def replay(
    rows: Iterable[LogRow],
    *,
    as_of: datetime | None = None,
    key: Callable[[LogRow], str] = lambda row: row.entity_id,
    current: Mapping[str, Mapping[str, Any]] | None = None,
) -> dict[str, Replayed]:
    """key -> the record as of `as_of` (every row when None); records with no row by then are
    absent. `current` is each record as it stands now, in its logged fields' shape; it settles a
    same-instant clash that no later row settles."""
    histories: dict[str, list[LogRow]] = defaultdict(list)
    for row in rows:
        histories[key(row)].append(row)
    out: dict[str, Replayed] = {}
    for name, history in histories.items():
        history.sort(key=_order)
        replayed = _replay_one(history, as_of, current.get(name) if current is not None else None)
        if replayed is not None:
            out[name] = replayed
    return out
