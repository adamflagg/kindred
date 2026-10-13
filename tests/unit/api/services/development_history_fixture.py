"""A PocketBase double that APPLIES the filters it is sent, for Reports › Development's history read
(DevelopmentRepository.earlier_attendance) and the reads around it. Fictional only (tests/CLAUDE.md).

Unlike RecordingPb (which serves whole tables and ignores filters), this one evaluates each filter: `&&`, `||`,
parentheses and `= != >= <= > <` against an int or a quoted string, on a row's own column or THROUGH a relation
(`person.household_id` reads the related person row's household_id, as PocketBase's join does; a row with no
related record never matches). `expand=` serves only the relations asked for, and `fields=` projects the row and
each expand to the columns it names (`*` is every column of the row itself). Any other filter shape is refused, so
a reader cannot pass because the double misread it. Every read is recorded with its query."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

_TOKEN = re.compile(
    r"\s*(?:(?P<punct>\(|\)|&&|\|\|)"
    r"|(?P<field>[a-z_]+(?:\.[a-z_]+)?)\s*(?P<op>>=|<=|!=|=|>|<)\s*(?P<value>-?\d+|'[^']*'|\"[^\"]*\"))"
)


@dataclass
class Row:
    """One stored record: its own columns, and the records its relation fields point at (None: unlinked)."""

    id: str
    columns: dict[str, Any]
    relations: dict[str, Row | None] = field(default_factory=dict)


@dataclass(frozen=True)
class Read:
    collection: str
    query: dict[str, Any]
    rows: int


def _tokens(text: str) -> list[tuple[str, ...]]:
    out: list[tuple[str, ...]] = []
    at = 0
    text = text.strip()
    while at < len(text):
        match = _TOKEN.match(text, at)
        if match is None:
            raise NotImplementedError(f"filter shape not understood at {text[at:]!r}")
        if match.group("punct"):
            out.append(("punct", match.group("punct")))
        else:
            raw = match.group("value")
            value: Any = raw[1:-1] if raw[0] in "'\"" else int(raw)
            out.append(("cmp", match.group("field"), match.group("op"), value))
        at = match.end()
        while at < len(text) and text[at].isspace():
            at += 1
    return out


class _Parser:
    """expr := term ('||' term)* ; term := factor ('&&' factor)* ; factor := '(' expr ')' | comparison."""

    def __init__(self, text: str) -> None:
        self.tokens = _tokens(text)
        self.at = 0

    def parse(self) -> Any:
        tree = self._expr()
        if self.at != len(self.tokens):
            raise NotImplementedError(f"trailing filter tokens: {self.tokens[self.at :]}")
        return tree

    def _peek(self, punct: str) -> bool:
        return self.at < len(self.tokens) and self.tokens[self.at] == ("punct", punct)

    def _expr(self) -> Any:
        terms = [self._term()]
        while self._peek("||"):
            self.at += 1
            terms.append(self._term())
        return ("or", terms)

    def _term(self) -> Any:
        factors = [self._factor()]
        while self._peek("&&"):
            self.at += 1
            factors.append(self._factor())
        return ("and", factors)

    def _factor(self) -> Any:
        if self._peek("("):
            self.at += 1
            inner = self._expr()
            if not self._peek(")"):
                raise NotImplementedError("unbalanced parentheses")
            self.at += 1
            return inner
        if self.at >= len(self.tokens) or self.tokens[self.at][0] != "cmp":
            raise NotImplementedError(f"expected a comparison at token {self.at}")
        token = self.tokens[self.at]
        self.at += 1
        return token


_MISSING = object()


def _value(row: Row, path: str) -> Any:
    if "." not in path:
        if path == "id":
            return row.id
        if path not in row.columns:
            raise NotImplementedError(f"no column {path!r} on this row")
        return row.columns[path]
    relation, column = path.split(".", 1)
    if relation not in row.relations:
        raise NotImplementedError(f"no relation {relation!r} on this row")
    related = row.relations[relation]
    if related is None:
        return _MISSING  # an unlinked relation matches nothing, as PocketBase's join
    return _value(related, column)


def _holds(tree: Any, row: Row) -> bool:
    kind = tree[0]
    if kind == "or":
        return any(_holds(t, row) for t in tree[1])
    if kind == "and":
        return all(_holds(t, row) for t in tree[1])
    _, path, op, wanted = tree
    got = _value(row, path)
    if got is _MISSING or got is None:
        return False
    if op == "=":
        return bool(got == wanted)
    if op == "!=":
        return bool(got != wanted)
    if op == ">=":
        return bool(got >= wanted)
    if op == "<=":
        return bool(got <= wanted)
    if op == ">":
        return bool(got > wanted)
    return bool(got < wanted)


def _projected(row: Row, expand: list[str], fields: str | None) -> SimpleNamespace:
    named = [f.strip() for f in fields.split(",")] if fields else None
    own = {"id": row.id, **row.columns}
    if named is not None and "*" not in named:
        own = {k: v for k, v in own.items() if k in named}
    expanded: dict[str, Any] = {}
    for relation in expand:
        if relation not in row.relations:
            raise NotImplementedError(f"no relation {relation!r} to expand")
        related = row.relations[relation]
        if related is None:
            continue
        columns = {"id": related.id, **related.columns}
        if named is not None:
            prefix = f"expand.{relation}."
            wanted = {f[len(prefix) :] for f in named if f.startswith(prefix)}
            columns = {k: v for k, v in columns.items() if k in wanted}
        expanded[relation] = SimpleNamespace(**columns)
    return SimpleNamespace(**own, expand=expanded)


def _sort_value(row: Row, column: str) -> str:
    return str(row.id if column == "id" else row.columns.get(column, ""))


@dataclass
class FilteringPb:
    tables: dict[str, list[Row]] = field(default_factory=dict)
    reads: list[Read] = field(default_factory=list)

    def collection(self, name: str) -> _Collection:
        return _Collection(self, name)

    def count(self, collection: str) -> int:
        return sum(1 for r in self.reads if r.collection == collection)

    def reset(self) -> None:
        self.reads.clear()


@dataclass
class _Collection:
    pb: FilteringPb
    name: str

    def get_full_list(self, batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
        query = dict(query_params or {})
        text = str(query.get("filter", "") or "")
        tree = _Parser(text).parse() if text else None
        rows = [r for r in self.pb.tables.get(self.name, []) if tree is None or _holds(tree, r)]
        for key in reversed([k.strip() for k in str(query.get("sort", "") or "").split(",") if k.strip()]):
            column = key.lstrip("-+")
            rows.sort(key=lambda r: _sort_value(r, column), reverse=key.startswith("-"))
        expand = [e for e in str(query.get("expand", "") or "").split(",") if e]
        fields = query.get("fields")
        self.pb.reads.append(Read(self.name, query, len(rows)))
        return [_projected(r, expand, str(fields) if fields else None) for r in rows]
