"""What PocketBase sends back for a `fields=` projection, for equivalence tests.

A `fields=` list is a query-param change with exactly one way to go wrong: a
column the consumer reads but the list leaves out comes back ABSENT, and most
consumers read with `getattr(..., default)`, so it reads as ""/0/None rather
than failing. Tests that narrow a read serve the same wide fixture rows once in
full and once through `project`, and compare the consumer's output.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def project(data: dict[str, Any], fields: str | None) -> dict[str, Any]:
    """Only the named paths of `data`, the way PocketBase projects them.

    `expand.rel.col` keeps one column of an expanded relation; a bare name
    keeps one top-level column; `*` keeps every top-level column. With no
    `fields` at all, the whole row.
    """
    if not fields:
        return deepcopy(data)
    out: dict[str, Any] = {}
    for path in fields.split(","):
        _copy_path(data, out, path.strip().split("."))
    return out


def _copy_path(src: dict[str, Any], dst: dict[str, Any], parts: list[str]) -> None:
    head, rest = parts[0], parts[1:]
    if head == "*":
        for key, value in src.items():
            if key != "expand":
                dst.setdefault(key, deepcopy(value))
        return
    if head not in src:
        return
    if not rest:
        dst[head] = deepcopy(src[head])
        return
    value = src[head]
    if isinstance(value, dict):
        _copy_path(value, dst.setdefault(head, {}), rest)
