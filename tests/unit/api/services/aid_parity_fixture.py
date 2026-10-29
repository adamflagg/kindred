"""An in-memory PocketBase double that EVALUATES the filters the Camperships person, household, enrollment and
equity reads send, over a small fixture built to hold every membership route those reads must honour.

Unlike pb_recording.RecordingPb (counts calls, returns whole tables), this double answers row sets, so a parity
test can pin what a read returns. It serves the filter shapes the reads emit today and the shapes a whole-year
cache emits (a bare `year = N`, field_definition by PocketBase id, custom_field_defs by cm_id). Any other
filter, sort, expand or collection raises NotImplementedError, so a new shape can't silently match everything.

The FA mirror (financial_aid_applications) is served too, with the operators its four readers send: `>` on the
asks, `~` on the grant answers (SQLite's LIKE: a contains whose case folding is ASCII-only, so a non-ASCII letter
never matches an ASCII one), `= true` on is_applicant, and `household.cm_id = N` through the relation. The sync
tables still accept `=` alone.

`fields=` is honoured: each row comes back as a projected COPY holding `id`, the named columns (`*`: every column)
and any `expand.<relation>.<column>` paths (a read that forgets a column fails); the stored record is never mutated.
`expand` is honoured per query: a row's `expand` dict holds exactly the relations the query asked for, resolved
from its relation ids. Unprojected, an expanded record is the very object the related collection returns."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Final

from api.services.financial_aid_household import HOUSEHOLD_ANSWER_FIELDS

PARITY_YEAR: Final = 2026
PRIOR_YEAR: Final = 2025

# --- synthetic CampMinder ids -------------------------------------------------------------------------------------
H1, H2, H3, H4, H5, H6 = 4000101, 4000102, 4000103, 4000104, 4000105, 4000106
P1, P2, P3, P4, P5 = 1000001, 1000002, 1000003, 1000004, 1000005
P6_CM = P1  # the 2025-only person shares P1's cm_id: CampMinder ids repeat across years
S1, S2 = 5000001, 5000002
CAMPER_FIELD_CM, ADULT_FIELD_CM, OTHER_FIELD_CM = 165525, 209079, 165526  # one off the camper field's cm_id

# --- PocketBase record ids (15 chars) ---------------------------------------------------------------------------
# Person ids are deliberately NOT in cm_id order, and the table is stored in yet another order, so a read that
# promises `sort=id` is distinguishable from one that returns insertion order.
HH_ID = {
    H1: "hh0000000000a01",
    H2: "hh0000000000a02",
    H3: "hh0000000000a03",
    H4: "hh0000000000a04",
    H5: "hh0000000000a05",
    H6: "hh0000000000a06",
}
HH_PRIOR_H1_ID = "hh0000000000b01"
PERSON_ID = {
    P1: "pp0000000000c20",
    P2: "pp0000000000c10",
    P3: "pp0000000000c30",
    P4: "pp0000000000c40",
    P5: "pp0000000000c50",
}
PERSON_PRIOR_ID = "pp0000000000d01"
SESSION_ID = {S1: "ss0000000000e01", S2: "ss0000000000e02"}
SESSION_PRIOR_S1_ID = "ss0000000000f01"
FIELD_DEF_ID = {
    CAMPER_FIELD_CM: "fd0000000000g01",
    ADULT_FIELD_CM: "fd0000000000g02",
    OTHER_FIELD_CM: "fd0000000000g03",
}
FIELD_DEF_PRIOR_CAMPER_ID = "fd0000000000h01"
ATTENDEE_ID = {name: f"at00000000000{name}" for name in ("a1", "a2", "a3", "a4", "a5", "a6")}
PCV_ID = {name: f"pv00000000000{name}" for name in ("v1", "v2", "v3", "v4", "v5", "v6")}
# FA mirror rows. Stored in neither id nor person order; H6's row (f1) sorts FIRST by id, so a per-household read
# that chunks (H6 lands in the second chunk) returns it last, while a whole-season `sort=id` read returns it first.
FA_ID = {name: f"fa00000000000{name}" for name in ("f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9")}
# Applicants on the form with no persons record in the fixture (only the mirror's person_id is read).
P11, P12, P13 = 1000011, 1000012, 1000013

_COLLECTION_FIELDS: Final[dict[str, frozenset[str]]] = {
    "persons": frozenset(
        {
            "year",
            "cm_id",
            "household_id",
            "household.cm_id",
            "primary_childhood_household.cm_id",
            "alternate_childhood_household.cm_id",
        }
    ),
    "households": frozenset({"year", "cm_id"}),
    "attendees": frozenset({"year", "person_id", "status_id", "person.household_id", "person.cm_id"}),
    "person_custom_values": frozenset({"year", "person.cm_id", "field_definition", "field_definition.cm_id"}),
    "custom_field_defs": frozenset({"year", "cm_id"}),
    "camp_sessions": frozenset({"year", "cm_id"}),
}
# The FA mirror, kept apart from the sync tables above: aid_season_fixture serves those six through this
# evaluator and every other collection through its own, which already holds the mirror.
_MIRROR_FIELDS: Final[dict[str, frozenset[str]]] = {
    "financial_aid_applications": frozenset(
        {
            "year",
            "is_applicant",
            "summer_amount_requested",
            "fc_amount_requested",
            "tbm_amount_requested",
            "household.cm_id",
            "one_happy_camper",
            "synagogue_grant",
        }
    ),
}
_FILTER_FIELDS: Final[dict[str, frozenset[str]]] = {**_COLLECTION_FIELDS, **_MIRROR_FIELDS}
# The operators a filter field may take beyond `=` (every other field: `=` only).
_FIELD_OPS: Final[dict[str, dict[str, frozenset[str]]]] = {
    "financial_aid_applications": {
        "summer_amount_requested": frozenset({">"}),
        "fc_amount_requested": frozenset({">"}),
        "tbm_amount_requested": frozenset({">"}),
        "one_happy_camper": frozenset({"~"}),
        "synagogue_grant": frozenset({"~"}),
    }
}
# relation field -> collection it points at; also the only expands each collection may ask for
_RELATIONS: Final[dict[str, dict[str, str]]] = {
    "persons": {
        "household": "households",
        "primary_childhood_household": "households",
        "alternate_childhood_household": "households",
    },
    "attendees": {"person": "persons", "session": "camp_sessions"},
    "person_custom_values": {"person": "persons", "field_definition": "custom_field_defs"},
    "financial_aid_applications": {"household": "households"},
}

_TOKEN = re.compile(r"\s*(?:(&&|\|\||=|>|~|\(|\))|\"([^\"]*)\"|'([^']*)'|(-?\d+)|([A-Za-z_][A-Za-z_0-9.]*))")


def _tokenize(text: str) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    pos = 0
    while pos < len(text):
        if not text[pos:].strip():
            break
        m = _TOKEN.match(text, pos)
        if m is None:
            raise NotImplementedError(f"unsupported filter text at {pos}: {text!r}")
        op, dq, sq, num, ident = m.groups()
        if op:
            out.append(("op", op))
        elif dq is not None:
            out.append(("str", dq))
        elif sq is not None:
            out.append(("str", sq))
        elif num is not None:
            out.append(("num", int(num)))
        else:
            out.append(("id", ident))
        pos = m.end()
    return out


class _Parser:
    """`||` of `&&` of (`field = value` | `( expr )`), nothing else -- except the operators _FIELD_OPS allows."""

    def __init__(self, text: str, allowed: frozenset[str], ops: dict[str, frozenset[str]] | None = None) -> None:
        self.tokens = _tokenize(text)
        self.i = 0
        self.allowed = allowed
        self.ops = ops or {}
        self.text = text

    def _peek(self) -> tuple[str, Any] | None:
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def _next(self) -> tuple[str, Any]:
        tok = self._peek()
        if tok is None:
            raise NotImplementedError(f"unsupported filter (ends early): {self.text!r}")
        self.i += 1
        return tok

    def parse(self) -> Any:
        node = self._or()
        if self._peek() is not None:
            raise NotImplementedError(f"unsupported filter (trailing text): {self.text!r}")
        return node

    def _or(self) -> Any:
        parts = [self._and()]
        while self._peek() == ("op", "||"):
            self.i += 1
            parts.append(self._and())
        return ("or", parts)

    def _and(self) -> Any:
        parts = [self._atom()]
        while self._peek() == ("op", "&&"):
            self.i += 1
            parts.append(self._atom())
        return ("and", parts)

    def _atom(self) -> Any:
        tok = self._next()
        if tok == ("op", "("):
            node = self._or()
            if self._next() != ("op", ")"):
                raise NotImplementedError(f"unsupported filter (unbalanced): {self.text!r}")
            return node
        if tok[0] != "id" or tok[1] not in self.allowed:
            raise NotImplementedError(f"unsupported filter field {tok[1]!r} in {self.text!r}")
        op = self._next()
        if op[0] != "op" or op[1] not in self.ops.get(tok[1], frozenset({"="})):
            raise NotImplementedError(f"unsupported operator {op[1]!r} on {tok[1]!r}: {self.text!r}")
        value = self._next()
        if value in (("id", "true"), ("id", "false")):
            return (op[1], tok[1], value[1] == "true")
        if value[0] not in ("num", "str"):
            raise NotImplementedError(f"unsupported filter value in {self.text!r}")
        return (op[1], tok[1], value[1])


_ASCII_LOWER: Final = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _like_contains(value: Any, pattern: str) -> bool:
    """PocketBase's `~` (no wildcard in `pattern`): SQLite's LIKE '%pattern%', which folds ASCII letters only."""
    return pattern.translate(_ASCII_LOWER) in str(value or "").translate(_ASCII_LOWER)


@dataclass
class FilteringPb:
    tables: dict[str, list[Any]] = field(default_factory=dict)
    calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def collection(self, name: str) -> _FilteringCollection:
        if name not in _FILTER_FIELDS:
            raise NotImplementedError(f"FilteringPb has no collection {name!r}")
        return _FilteringCollection(self, name)

    def resolve(self, collection: str, path: str, record: Any) -> Any:
        """The value of `path` on `record`: a plain field, or `relation.field` through the related record."""
        head, _, tail = path.partition(".")
        value = getattr(record, head, None)
        if not tail:
            return value
        target = _RELATIONS[collection][head]
        if not value:
            return None
        related = next((r for r in self.tables.get(target, []) if r.id == value), None)
        return None if related is None else getattr(related, tail, None)


@dataclass
class _FilteringCollection:
    pb: FilteringPb
    name: str

    def _evaluate(self, node: Any, record: Any) -> bool:
        kind = node[0]
        if kind == "or":
            return any(self._evaluate(n, record) for n in node[1])
        if kind == "and":
            return all(self._evaluate(n, record) for n in node[1])
        op, path, wanted = node
        value = self.pb.resolve(self.name, path, record)
        if op == ">":  # a PocketBase number column is never null: an unset one is 0
            return bool(float(value or 0) > wanted)
        if op == "~":
            return _like_contains(value, str(wanted))
        return bool(value == wanted)

    def get_full_list(self, batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
        params = dict(query_params or {})
        unknown = set(params) - {"filter", "sort", "expand", "fields"}
        if unknown:
            raise NotImplementedError(f"unsupported query params {sorted(unknown)}")
        self.pb.calls.append((self.name, params))
        flt = str(params.get("filter", "")).strip()
        rows = list(self.pb.tables.get(self.name, []))
        if flt:
            tree = _Parser(flt, _FILTER_FIELDS[self.name], _FIELD_OPS.get(self.name)).parse()
            rows = [r for r in rows if self._evaluate(tree, r)]
        expands = [e for e in str(params.get("expand", "")).split(",") if e]
        for expand in expands:
            if expand not in _RELATIONS.get(self.name, {}):
                raise NotImplementedError(f"unsupported expand {expand!r} on {self.name}")
        for key in reversed([k for k in str(params.get("sort", "")).split(",") if k]):
            desc = key.startswith("-")
            attr = key.lstrip("-+")
            if attr not in ("id", "created", "cm_id", "field_definition"):
                raise NotImplementedError(f"unsupported sort {key!r}")
            rows.sort(key=lambda r, a=attr: getattr(r, a, ""), reverse=desc)  # type: ignore[misc]
        columns = [c for c in str(params.get("fields", "")).split(",") if c]
        return [self._shape(r, expands, columns) for r in rows]

    def _shape(self, record: Any, expands: list[str], columns: list[str]) -> Any:
        """A copy of `record` carrying only the requested expand relations, projected to `fields` when given."""
        expand: dict[str, Any] = {}
        for relation in expands:
            rid = getattr(record, relation, "")
            if rid:
                expand[relation] = next(r for r in self.pb.tables[_RELATIONS[self.name][relation]] if r.id == rid)
        if not columns:
            return SimpleNamespace(**{**vars(record), "expand": expand})
        kept: dict[str, Any] = {"id": record.id}
        if "*" in columns:  # PocketBase's wildcard: every column at this level
            kept.update({k: v for k, v in vars(record).items() if k != "expand"})
        nested: dict[str, list[str]] = {}
        for column in columns:
            if column.startswith("expand."):
                _, relation, attr = column.split(".", 2)
                nested.setdefault(relation, []).append(attr)
            elif hasattr(record, column):
                kept[column] = getattr(record, column)
        projected: dict[str, Any] = {}
        for relation, attrs in nested.items():
            if relation in expand:
                related = expand[relation]
                projected[relation] = SimpleNamespace(**{a: getattr(related, a) for a in attrs if hasattr(related, a)})
        # A bare `*` keeps `expand` whole, as PocketBase does when no `expand.<relation>.<column>` names it.
        kept["expand"] = expand if "*" in columns and not nested else projected
        return SimpleNamespace(**kept)


def _rec(**kw: Any) -> SimpleNamespace:
    return SimpleNamespace(**kw)


def parity_pb() -> FilteringPb:
    """Households H1-H6, six persons, attendees, equity answers, and 2025 look-alikes that must never leak in.

    P1 lives in H1.                       P2 lives in H2 with H1 as primary childhood household (under both).
    P3 lives in H3, H4 is alternate.      P4: household_id says H5, the `household` relation says H6 (under both).
    P5 has no household.                  P6 (2025 only) shares P1's cm_id, and is in a 2025 H1.

    The FA mirror (f1-f9) holds every route its four readers take: applicants and not, each program's ask 0,
    positive and unset, a row with no household, grant answers that match `~ 'yes'` in any case and ones that must
    not (a non-ASCII near-miss among them), two rows in one household, and a 2025 look-alike of P1's row.
    """
    households = [
        _rec(
            id=HH_ID[H1],
            year=PARITY_YEAR,
            cm_id=H1,
            greeting="Johnson Family",
            mailing_title="Mr. and Mrs. Johnson",
            aid_adults='[{"first_name": "Dana", "last_name": "Johnson"}]',
        ),
        _rec(id=HH_ID[H2], year=PARITY_YEAR, cm_id=H2, greeting="Garcia Family", mailing_title="", aid_adults="[]"),
        _rec(id=HH_ID[H3], year=PARITY_YEAR, cm_id=H3, greeting="", mailing_title="", aid_adults="[]"),
        _rec(
            id=HH_ID[H4],
            year=PARITY_YEAR,
            cm_id=H4,
            greeting="Chen Family",
            mailing_title="Chen Household",
            aid_adults="[]",
        ),
        _rec(id=HH_ID[H5], year=PARITY_YEAR, cm_id=H5, greeting="Sam Family", mailing_title="", aid_adults="[]"),
        _rec(id=HH_ID[H6], year=PARITY_YEAR, cm_id=H6, greeting="Sam Household", mailing_title="", aid_adults="[]"),
        _rec(
            id=HH_PRIOR_H1_ID,
            year=PRIOR_YEAR,
            cm_id=H1,
            greeting="Old Johnson Family",
            mailing_title="Old Johnsons",
            aid_adults="[]",
        ),
    ]

    def person(
        key: str, year: int, cm_id: int, household_id: int, first: str, last: str, birth: str, **kw: Any
    ) -> SimpleNamespace:
        return _rec(
            id=key,
            year=year,
            cm_id=cm_id,
            household_id=household_id,
            first_name=first,
            last_name=last,
            preferred_name=kw.pop("preferred_name", ""),
            birthdate=birth,
            gender_identity_name=kw.pop("gender_identity_name", ""),
            gender_pronoun_name=kw.pop("gender_pronoun_name", ""),
            household=kw.pop("household", ""),
            primary_childhood_household=kw.pop("primary_childhood_household", ""),
            alternate_childhood_household=kw.pop("alternate_childhood_household", ""),
        )

    # Stored in an order that is neither cm_id order nor id order.
    persons = [
        person(PERSON_ID[P4], PARITY_YEAR, P4, H5, "Riley", "Sam", "2015-06-01", household=HH_ID[H6]),
        person(PERSON_PRIOR_ID, PRIOR_YEAR, P6_CM, H1, "Emma", "Johnson", "2009-01-01", household=HH_PRIOR_H1_ID),
        person(
            PERSON_ID[P1],
            PARITY_YEAR,
            P1,
            H1,
            "Emma",
            "Johnson",
            "2012-04-09",
            household=HH_ID[H1],
            gender_identity_name="Girl",
            gender_pronoun_name="she/her",
        ),
        person(PERSON_ID[P5], PARITY_YEAR, P5, 0, "Samuel", "Johnson", ""),
        person(
            PERSON_ID[P3],
            PARITY_YEAR,
            P3,
            H3,
            "Olivia",
            "Chen",
            "2013-08-30",
            household=HH_ID[H3],
            alternate_childhood_household=HH_ID[H4],
            gender_identity_name="Nonbinary",
        ),
        person(
            PERSON_ID[P2],
            PARITY_YEAR,
            P2,
            H2,
            "Liam",
            "Garcia",
            "2011-11-15",
            household=HH_ID[H2],
            primary_childhood_household=HH_ID[H1],
            preferred_name="Lee",
            gender_pronoun_name="he/him",
        ),
    ]

    sessions = [
        _rec(id=SESSION_ID[S1], year=PARITY_YEAR, cm_id=S1, name="Session One"),
        _rec(id=SESSION_ID[S2], year=PARITY_YEAR, cm_id=S2, name="Session Two"),
        _rec(id=SESSION_PRIOR_S1_ID, year=PRIOR_YEAR, cm_id=S1, name="Session One"),
    ]

    def attendee(
        key: str, year: int, person_cm: int, person_pb: str, status: int, session_pb: str, when: str
    ) -> SimpleNamespace:
        return _rec(
            id=ATTENDEE_ID[key],
            year=year,
            person_id=person_cm,
            person=person_pb,
            status_id=status,
            session=session_pb,
            enrollment_date=when,
        )

    attendees = [
        attendee("a5", PARITY_YEAR, P3, PERSON_ID[P3], 2, "", "2026-02-01 18:00:00.000Z"),  # no session
        attendee("a2", PARITY_YEAR, P1, PERSON_ID[P1], 4, SESSION_ID[S2], "2026-03-01 18:00:00.000Z"),  # status 4
        attendee("a1", PARITY_YEAR, P1, PERSON_ID[P1], 2, SESSION_ID[S1], "2026-03-05 18:00:00.000Z"),
        attendee("a6", PRIOR_YEAR, P6_CM, PERSON_PRIOR_ID, 2, SESSION_PRIOR_S1_ID, "2025-03-05 18:00:00.000Z"),
        attendee("a4", PARITY_YEAR, P2, PERSON_ID[P2], 256, SESSION_ID[S2], "2026-04-11 18:00:00.000Z"),
        attendee("a3", PARITY_YEAR, P2, PERSON_ID[P2], 32, SESSION_ID[S1], "2026-04-10 18:00:00.000Z"),
    ]

    field_defs = [
        _rec(id=FIELD_DEF_ID[CAMPER_FIELD_CM], year=PARITY_YEAR, cm_id=CAMPER_FIELD_CM, name="Camper POC"),
        _rec(id=FIELD_DEF_ID[ADULT_FIELD_CM], year=PARITY_YEAR, cm_id=ADULT_FIELD_CM, name="Adult POC"),
        _rec(id=FIELD_DEF_ID[OTHER_FIELD_CM], year=PARITY_YEAR, cm_id=OTHER_FIELD_CM, name="Unrelated"),
        _rec(id=FIELD_DEF_PRIOR_CAMPER_ID, year=PRIOR_YEAR, cm_id=CAMPER_FIELD_CM, name="Camper POC"),
    ]

    def value(key: str, year: int, person_pb: str, def_pb: str, text: str) -> SimpleNamespace:
        return _rec(id=PCV_ID[key], year=year, person=person_pb, field_definition=def_pb, value=text)

    values = [
        value("v5", PARITY_YEAR, PERSON_ID[P3], FIELD_DEF_ID[OTHER_FIELD_CM], "Yes"),  # unrelated field: ignored
        value("v1", PARITY_YEAR, PERSON_ID[P1], FIELD_DEF_ID[CAMPER_FIELD_CM], "Yes"),
        value("v2", PARITY_YEAR, PERSON_ID[P1], FIELD_DEF_ID[ADULT_FIELD_CM], "No"),
        value("v3", PARITY_YEAR, PERSON_ID[P2], FIELD_DEF_ID[ADULT_FIELD_CM], "yes"),
        value("v6", PARITY_YEAR, PERSON_ID[P4], FIELD_DEF_ID[CAMPER_FIELD_CM], "maybe"),  # unparseable: unanswered
        value("v4", PRIOR_YEAR, PERSON_PRIOR_ID, FIELD_DEF_PRIOR_CAMPER_ID, "No"),  # 2025 look-alike of P1
    ]

    tables: dict[str, list[Any]] = {
        "households": households,
        "persons": persons,
        "camp_sessions": sessions,
        "custom_field_defs": field_defs,
        "attendees": attendees,
        "person_custom_values": values,
        "financial_aid_applications": _fa_mirror(),
    }
    return FilteringPb(tables=tables)


def _fa_mirror() -> list[SimpleNamespace]:
    def fa(
        key: str, person_cm: int, household_pb: str, *, applicant: bool, year: int = PARITY_YEAR, **kw: Any
    ) -> SimpleNamespace:
        """A mirror row with every column its readers name, at PocketBase's empty values unless given, and the
        contact details no reader may carry (the layer-1 projection must leave them on the server)."""
        row: dict[str, Any] = dict.fromkeys(HOUSEHOLD_ANSWER_FIELDS)
        row.update(
            id=FA_ID[key],
            year=year,
            person_id=person_cm,
            household=household_pb,
            is_applicant=applicant,
            contact_first_name="",
            contact_last_name="",
            contact_email="family@example.org",
            contact_phone="555-0100",
            contact_address="1 Example Way",
            summer_program="",
            summer_amount_requested=0,
            fc_program="",
            fc_amount_requested=0,
            tbm_program="",
            tbm_amount_requested=0,
            interest_expressed=False,
            registration_request_amount=0,
            camper_interest_expressed=False,
            camper_registration_request_amount=0,
            adult_weekend_interest_expressed=False,
            adult_weekend_registration_request_amount=0,
            reported_income_fields=None,
            one_happy_camper="",
            synagogue_grant="",
        )
        row.update(kw)
        return _rec(**row)

    # Stored in neither id order nor person order. None stands for an ask the row leaves unset.
    return [
        fa(
            "f5",
            P5,
            "",
            applicant=True,
            summer_amount_requested=900,
            one_happy_camper="Yes",
            contact_first_name="Samuel",
            contact_last_name="Johnson",
        ),  # no household
        fa(
            "f2",
            P1,
            HH_ID[H1],
            applicant=True,
            summer_program="Session One",
            summer_amount_requested=1500,
            fc_amount_requested=None,
            one_happy_camper="yes",
            contact_first_name="Dana",
            contact_last_name="Johnson",
            interest_expressed=True,
            registration_request_amount=700,
            camper_interest_expressed=True,
            camper_registration_request_amount=700,
            adult_weekend_interest_expressed=False,
            adult_weekend_registration_request_amount=0,
            total_gross_income=0,
            unemployment="No",
            special_circumstances="Moved this year",
            reported_income_fields='["total_gross_income"]',
        ),
        fa(
            "f9",
            P6_CM,
            HH_PRIOR_H1_ID,
            applicant=True,
            year=PRIOR_YEAR,
            summer_amount_requested=2000,
            one_happy_camper="yes",
            synagogue_grant="yes",
            contact_first_name="Old",
            contact_last_name="Johnson",
        ),
        fa(
            "f7",
            P12,
            HH_ID[H5],
            applicant=True,
            fc_amount_requested=None,
            one_happy_camper="maybe",
            contact_first_name="Ava",
            contact_last_name="Okafor",
        ),  # applicant, nothing asked
        fa(
            "f1",
            P4,
            HH_ID[H6],
            applicant=True,
            tbm_program="B-Mitzvah",
            tbm_amount_requested=600,
            one_happy_camper="ye\u017f",  # "yeſ": LONG S, which casefold() would read as "s"
            synagogue_grant="No",
            contact_first_name="Riley",
            contact_last_name="Sam",
        ),
        fa(
            "f4",
            P3,
            HH_ID[H3],
            applicant=False,
            synagogue_grant="Yes, please",
            contact_first_name="Wei",
            contact_last_name="Chen",
        ),  # donation-only: not an application
        fa(
            "f8",
            P13,
            HH_ID[H1],
            applicant=True,
            summer_amount_requested=700,
            tbm_amount_requested=250,
            synagogue_grant="YES",
            contact_first_name="Dana",
            contact_last_name="Johnson",
        ),  # H1's second camper
        fa(
            "f3",
            P2,
            HH_ID[H2],
            applicant=True,
            summer_amount_requested=None,
            fc_program="Family Camp 2",
            fc_amount_requested=800,
            tbm_amount_requested=None,
            one_happy_camper="YES",
            synagogue_grant="no",
            contact_first_name="Maria",
            contact_last_name="Garcia",
            gov_subsidies="Yes",
        ),
        fa("f6", P11, HH_ID[H4], applicant=False, summer_amount_requested=300, one_happy_camper="no"),
    ]
