"""A PocketBase double that records every read: (collection, filter). Filters are not evaluated -- every
read returns the collection's whole table, which every Camperships reader tolerates (they key by id) -- so
call COUNTS are exact while row sets are supersets. For budget tests, never for row-level assertions."""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Final

HEAVY: Final = frozenset({"persons", "attendees", "person_custom_values", "households"})


@dataclass
class RecordingPb:
    tables: dict[str, list[Any]] = field(default_factory=dict)
    calls: list[tuple[str, str]] = field(default_factory=list)

    def collection(self, name: str) -> _RecordingCollection:
        return _RecordingCollection(self, name)

    def count(self, collection: str) -> int:
        return sum(1 for c, _ in self.calls if c == collection)

    def reset(self) -> None:
        self.calls.clear()


@dataclass
class _RecordingCollection:
    pb: RecordingPb
    name: str

    def _record(self, query_params: dict[str, Any] | None) -> list[Any]:
        self.pb.calls.append((self.name, str((query_params or {}).get("filter", ""))))
        return list(self.pb.tables.get(self.name, []))

    def get_full_list(self, batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
        return self._record(query_params)

    def get_list(self, page: int = 1, per_page: int = 30, query_params: dict[str, Any] | None = None) -> Any:
        rows = self._record(query_params)
        return SimpleNamespace(items=rows, page=1, per_page=per_page, total_items=len(rows), total_pages=1)

    def get_first_list_item(self, filter: str, query_params: dict[str, Any] | None = None) -> Any:
        rows = self._record({"filter": filter, **(query_params or {})})
        if not rows:
            raise LookupError(filter)
        return rows[0]
