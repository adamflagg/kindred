"""A whole Camperships season for the season parity test, served by an in-memory PocketBase that EVALUATES every
filter a season build sends (test_aid_season_parity.py).

Extends aid_parity_fixture.FilteringPb without changing it: the six sync-written tables (persons, households,
attendees, person_custom_values, custom_field_defs, camp_sessions) are answered by FilteringPb's own evaluator,
and the aid_* collections, the FA mirror and sync_runs by a second evaluator here, which also knows `!=`, `>`,
`>=`, `<`, `<=` and `~`, `fields=` and `get_list`. Both fail LOUDLY: an unknown collection, filter field,
operator, sort, expand or query param raises NotImplementedError, and so does a `fields=` column a stored row
lacks. Every refusal is also recorded on `SeasonPb.refused`, so a reader that swallowed one cannot make parity
pass on a season that silently read nothing.

The season (SEASON_YEAR) holds every route a number on a Camperships screen takes, with a PRIOR_SEASON look-alike
row in every year-scoped table, sharing CampMinder ids, that year scoping must keep out:

    Johnson  Emma: summer request, Round 1 posted and accepted, Round 2 asked; a camp-aid line and an outside grant
             line on her; One Happy Camper answered yes. An income correction on the application. Pays half of Liam.
    Garcia   Liam (also in Johnson, his primary childhood household): summer request, payer shares 50/50 with
             Johnson, a staff Round 3 award awaiting approval, a manual hold. A household-level camp-aid line an
             attribution override places on him. Linked to Johnson as one family.
    Chen     Olivia: summer request, Round 1 posted, then CampMinder cancelled her registration and reversed the
             line (a clawback); the cancellation reason recorded in Kindred.
    Sam      a Family Camp household-level request (two people), with a cost override.
    Rivera   Noah: summer request cancelled in Kindred; a Round 1 posted then un-posted; an open grant commitment.
    Okafor   never applied: one outside grant line, which could be Ava's or Samuel Johnson's. Samuel is in Okafor
             (his alternate childhood household) as well as in his own (Johnson), so the line ties to neither.

Fictional throughout (tests/CLAUDE.md)."""

from __future__ import annotations

import operator
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Final

from bunking.financial_aid.change_log import AidWrite
from tests.unit.api.services.aid_parity_fixture import _COLLECTION_FIELDS as SYNC_FIELDS
from tests.unit.api.services.aid_parity_fixture import _RELATIONS as SYNC_RELATIONS
from tests.unit.api.services.aid_parity_fixture import FilteringPb, _FilteringCollection
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR

SEASON_YEAR: Final = YEAR  # 2027: the year intake_rules() prices
PRIOR_SEASON: Final = YEAR - 1

# --- CampMinder ids (synthetic) ------------------------------------------------------------------------------------
JOHNSON, GARCIA, CHEN, SAM, RIVERA, OKAFOR = 6000101, 6000102, 6000103, 6000104, 6000105, 6000106
EMMA, DANA, LIAM, OLIVIA, RILEY, MAYA, NOAH, AVA, SAMUEL = range(7000101, 7000110)
SUMMER_SESSION, TASTE_SESSION, FAMILY_CAMP_SESSION = 1000101, 1000104, 1000202
CAMPER_POC_FIELD, ADULT_POC_FIELD, UNRELATED_FIELD = 165525, 209079, 165526
# Ledger transactions
T_EMMA_CAMP, T_CHEN_CAMP, T_GARCIA_CAMP, T_EMMA_GRANT, T_OKAFOR_GRANT, T_PRIOR = (
    8000001,
    8000002,
    8000003,
    8000004,
    8000005,
    8000009,
)

# --- PocketBase record ids (15 chars, lowercase) --------------------------------------------------------------------
REQ_EMMA, REQ_LIAM, REQ_OLIVIA, REQ_SAM, REQ_NOAH = (
    "rqemma000000001",
    "rqliam000000002",
    "rqolivia0000003",
    "rqsam0000000004",
    "rqnoah000000005",
)
REQ_PRIOR = "rqprior00000009"
APP_ID = {h: f"ap{h:013d}" for h in (JOHNSON, GARCIA, CHEN, SAM, RIVERA)}
APP_PRIOR = "apprior00000009"


def _hh_id(cm: int, year: int = SEASON_YEAR) -> str:
    return f"hh{year % 100:02d}{cm:011d}"


def _person_id(cm: int, year: int = SEASON_YEAR) -> str:
    return f"pp{year % 100:02d}{cm:011d}"


def _session_id(cm: int, year: int = SEASON_YEAR) -> str:
    return f"ss{year % 100:02d}{cm:011d}"


def _stamp(day: str, hour: int = 18) -> str:
    return f"{day} {hour:02d}:00:00.000Z"


def _rec(**kw: Any) -> SimpleNamespace:
    return SimpleNamespace(**kw)


# --- the second evaluator: aid_* collections, the FA mirror, sync_runs ---------------------------------------------

# collection -> the columns a filter may name. Only what a season build's readers send.
AID_FILTER_FIELDS: Final[dict[str, frozenset[str]]] = {
    "aid_applications": frozenset({"year"}),
    "aid_requests": frozenset({"year"}),
    "aid_application_corrections": frozenset({"year"}),
    "aid_payer_shares": frozenset({"year"}),
    "aid_decisions": frozenset({"year"}),
    "aid_hold_events": frozenset({"year"}),
    "aid_cancellations": frozenset({"year"}),
    "aid_grant_placements": frozenset({"year"}),
    "aid_attribution_overrides": frozenset({"year"}),
    "aid_household_links": frozenset({"year"}),
    "aid_grants": frozenset({"year"}),
    "aid_postings": frozenset({"year", "funder_type"}),
    "aid_sources": frozenset(),
    "aid_grantors": frozenset(),
    "financial_aid_applications": frozenset({"year", "one_happy_camper", "synagogue_grant"}),
    "sync_runs": frozenset({"service", "status", "year"}),
}
# collection -> the columns a sort may name, beyond id and created.
_AID_SORTS: Final[dict[str, frozenset[str]]] = {
    "aid_postings": frozenset({"transaction_cm_id"}),
    "aid_sources": frozenset({"description_key"}),
    "aid_grantors": frozenset({"name"}),
    "sync_runs": frozenset({"started"}),
}
_AID_RELATIONS: Final[dict[str, dict[str, str]]] = {"financial_aid_applications": {"household": "households"}}

_TOKEN: Final = re.compile(
    r"\s*(?:(&&|\|\||>=|<=|!=|=|>|<|~|\(|\))|\"([^\"]*)\"|'([^']*)'|(-?\d+)|([A-Za-z_][A-Za-z_0-9.]*))"
)
_COMPARE: Final[dict[str, Callable[[Any, Any], bool]]] = {
    "=": operator.eq,
    "!=": operator.ne,
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
}


def _tokens(text: str) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    pos = 0
    while text[pos:].strip():
        m = _TOKEN.match(text, pos)
        if m is None:
            raise NotImplementedError(f"unsupported filter text at {pos}: {text!r}")
        op, dq, sq, num, ident = m.groups()
        if op:
            out.append(("op", op))
        elif dq is not None or sq is not None:
            out.append(("str", dq if dq is not None else sq))
        elif num is not None:
            out.append(("num", int(num)))
        elif ident in ("true", "false"):
            out.append(("bool", ident == "true"))
        else:
            out.append(("id", ident))
        pos = m.end()
    return out


class _AidParser:
    """`||` of `&&` of (`field OP value` | `( expr )`), OP one of = != > >= < <= ~."""

    def __init__(self, text: str, allowed: frozenset[str]) -> None:
        self.tokens = _tokens(text)
        self.i = 0
        self.allowed = allowed
        self.text = text

    def _next(self) -> tuple[str, Any]:
        if self.i >= len(self.tokens):
            raise NotImplementedError(f"unsupported filter (ends early): {self.text!r}")
        self.i += 1
        return self.tokens[self.i - 1]

    def _peek(self) -> tuple[str, Any] | None:
        return self.tokens[self.i] if self.i < len(self.tokens) else None

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
        if op[0] != "op" or op[1] not in (*_COMPARE, "~"):
            raise NotImplementedError(f"unsupported operator {op[1]!r} in {self.text!r}")
        value = self._next()
        if value[0] not in ("num", "str", "bool"):
            raise NotImplementedError(f"unsupported filter value in {self.text!r}")
        return ("cmp", tok[1], op[1], value[1])


def _matches(node: Any, record: Any, collection: str) -> bool:
    kind = node[0]
    if kind == "or":
        return any(_matches(n, record, collection) for n in node[1])
    if kind == "and":
        return all(_matches(n, record, collection) for n in node[1])
    _, column, op, wanted = node
    if not hasattr(record, column):  # a filter on a column the row lacks would match nothing, silently
        raise NotImplementedError(f"{collection} row {record.id!r} has no {column!r} to filter on")
    value = getattr(record, column)
    if op == "~":  # PocketBase's LIKE: a case-insensitive contains
        return str(wanted).lower() in str(value or "").lower()
    if type(value) is not type(wanted) and not (isinstance(value, int) and isinstance(wanted, int)):
        raise NotImplementedError(f"{collection}.{column}: comparing {value!r} with {wanted!r}")
    return _COMPARE[op](value, wanted)


@dataclass
class _AidCollection:
    pb: SeasonPb
    name: str

    def _refuse(self, message: str) -> NotImplementedError:
        self.pb.refused.append(f"{self.name}: {message}")
        return NotImplementedError(message)

    def get_full_list(self, batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
        try:
            return self._rows(dict(query_params or {}))
        except NotImplementedError as exc:
            raise self._refuse(str(exc)) from exc

    def get_list(self, page: int = 1, per_page: int = 30, query_params: dict[str, Any] | None = None) -> Any:
        if page != 1:
            raise self._refuse(f"get_list page {page}")
        rows = self.get_full_list(query_params=query_params)
        return SimpleNamespace(items=rows[:per_page], page=1, per_page=per_page, total_items=len(rows))

    def _rows(self, params: dict[str, Any]) -> list[Any]:
        unknown = set(params) - {"filter", "sort", "expand", "fields"}
        if unknown:
            raise NotImplementedError(f"unsupported query params {sorted(unknown)}")
        self.pb.calls.append((self.name, params))
        rows = list(self.pb.tables.get(self.name, []))
        flt = str(params.get("filter", "")).strip()
        if flt:
            tree = _AidParser(flt, AID_FILTER_FIELDS[self.name]).parse()
            rows = [r for r in rows if _matches(tree, r, self.name)]
        sortable = {"id", "created", *_AID_SORTS.get(self.name, ())}
        for key in reversed([k for k in str(params.get("sort", "")).split(",") if k]):
            attr = key.lstrip("-+")
            if attr not in sortable:
                raise NotImplementedError(f"unsupported sort {key!r}")
            rows.sort(key=lambda r, a=attr: getattr(r, a), reverse=key.startswith("-"))  # type: ignore[misc]
        expands = [e for e in str(params.get("expand", "")).split(",") if e]
        relations = _AID_RELATIONS.get(self.name, {})
        for relation in expands:
            if relation not in relations:
                raise NotImplementedError(f"unsupported expand {relation!r}")
        columns = [c for c in str(params.get("fields", "")).split(",") if c]
        return [self._shape(r, expands, relations, columns) for r in rows]

    def _shape(self, record: Any, expands: list[str], relations: dict[str, str], columns: list[str]) -> Any:
        expand: dict[str, Any] = {}
        for relation in expands:
            rid = getattr(record, relation)
            if rid:
                expand[relation] = next(r for r in self.pb.tables[relations[relation]] if r.id == rid)
        if not columns:
            return SimpleNamespace(**{**vars(record), "expand": expand})
        kept: dict[str, Any] = {"id": record.id}
        nested: dict[str, dict[str, Any]] = {}
        for column in columns:
            if column == "*":
                kept.update(vars(record))
            elif column.startswith("expand."):
                _, relation, attr = column.split(".", 2)
                if relation in expand:
                    nested.setdefault(relation, {})[attr] = getattr(expand[relation], attr)
            elif hasattr(record, column):
                kept[column] = getattr(record, column)
            else:
                raise NotImplementedError(f"row {record.id!r} has no column {column!r}")
        kept["expand"] = {k: SimpleNamespace(**v) for k, v in nested.items()}
        return SimpleNamespace(**kept)


class _LoudSyncCollection(_FilteringCollection):
    """FilteringPb's own evaluator, refusing a `fields=` column a stored row lacks (FilteringPb drops it)."""

    pb: SeasonPb

    def get_full_list(self, batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
        try:
            self._check_columns(str((query_params or {}).get("fields", "")))
            return super().get_full_list(batch=batch, query_params=query_params)
        except NotImplementedError as exc:
            self.pb.refused.append(f"{self.name}: {exc}")
            raise

    def _check_columns(self, fields: str) -> None:
        for column in (c for c in fields.split(",") if c and c != "*"):
            if column.startswith("expand."):
                _, relation, attr = column.split(".", 2)
                target = SYNC_RELATIONS[self.name][relation]
                rows = [
                    r for r in self.pb.tables[target] if any(getattr(o, relation) == r.id for o in self._own_rows())
                ]
            else:
                attr, rows = column, self._own_rows()
            missing = [r.id for r in rows if not hasattr(r, attr)]
            if missing:
                raise NotImplementedError(f"rows {missing} have no column {column!r}")

    def _own_rows(self) -> list[Any]:
        return list(self.pb.tables.get(self.name, []))


@dataclass
class SeasonPb(FilteringPb):
    refused: list[str] = field(default_factory=list)
    written: list[AidWrite] = field(default_factory=list)

    def collection(self, name: str) -> Any:
        if name in SYNC_FIELDS:
            return _LoudSyncCollection(self, name)
        if name in AID_FILTER_FIELDS:
            return _AidCollection(self, name)
        self.refused.append(f"no collection {name!r}")
        raise NotImplementedError(f"SeasonPb has no collection {name!r}")

    def commit(self, writes: Sequence[AidWrite]) -> None:
        """Apply creates as PocketBase would store them (the season build writes only its placement log)."""
        for write in writes:
            if write.action != "create" or write.collection != "aid_grant_placements":
                raise NotImplementedError(f"SeasonPb commits only placement-log creates, not {write!r}")
            self.written.append(write)
            n = len(self.tables.setdefault(write.collection, []))
            self.tables[write.collection].append(
                _rec(id=f"gp{n:013d}", created=_stamp("2027-05-01", 17), **dict(write.data or {}))
            )


def committing(pb: SeasonPb) -> Callable[..., Awaitable[None]]:
    """A stand-in for FinancialAidDecisionsRepository.commit that applies the writes to `pb`. The real one sends a
    PocketBase batch, which this double has no transport for; what the build then reads back is what it wrote."""

    async def commit(writes: Sequence[AidWrite], **_kwargs: Any) -> None:
        pb.commit(writes)

    return commit


# --- the season ----------------------------------------------------------------------------------------------------


def _households() -> list[Any]:
    def household(cm: int, greeting: str, mailing: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=_hh_id(cm, year),
            year=year,
            cm_id=cm,
            greeting=greeting,
            mailing_title=mailing,
            alternate_mailing_title="",
            billing_mailing_title="",
            household_phone="",
            billing_address1="",
            billing_address2="",
            billing_city="",
            billing_state="",
            billing_postal_code="",
            billing_country="",
            aid_adults="[]",
            created=_stamp(f"{year}-01-05"),
            updated=_stamp(f"{year}-01-05"),
        )

    return [
        household(GARCIA, "Garcia Family", ""),
        household(JOHNSON, "Johnson Family", "Mr. and Mrs. Johnson"),
        household(JOHNSON, "Old Johnson Family", "The Old Johnsons", PRIOR_SEASON),  # look-alike
        household(CHEN, "", "Chen Household"),
        household(SAM, "Sam Family", ""),
        household(RIVERA, "Rivera Family", ""),
        household(OKAFOR, "Okafor Family", ""),
    ]


def _persons() -> list[Any]:
    def person(
        cm: int, household: int, first: str, last: str, birth: str, year: int = SEASON_YEAR, **kw: Any
    ) -> SimpleNamespace:
        return _rec(
            id=_person_id(cm, year),
            year=year,
            cm_id=cm,
            household_id=household,
            first_name=first,
            last_name=last,
            preferred_name=kw.pop("preferred_name", ""),
            birthdate=birth,
            gender_identity_name=kw.pop("gender_identity_name", ""),
            gender_pronoun_name=kw.pop("gender_pronoun_name", ""),
            household=_hh_id(household, year) if household else "",
            primary_childhood_household=kw.pop("primary_childhood_household", ""),
            alternate_childhood_household=kw.pop("alternate_childhood_household", ""),
            created=_stamp(f"{year}-01-05"),
            updated=_stamp(f"{year}-01-05"),
        )

    return [
        person(
            LIAM,
            GARCIA,
            "Liam",
            "Garcia",
            "2014-11-15",
            preferred_name="Lee",
            primary_childhood_household=_hh_id(JOHNSON),
        ),
        person(
            EMMA, JOHNSON, "Emma", "Johnson", "2013-04-09", gender_identity_name="Girl", gender_pronoun_name="she/her"
        ),
        person(EMMA, JOHNSON, "Emma", "Johnson", "2012-01-01", PRIOR_SEASON),  # look-alike: same cm_id
        person(DANA, JOHNSON, "Dana", "Johnson", "1984-02-02"),
        # In two households: his own (Johnson) and Okafor, his alternate childhood household. He is why Okafor's
        # grant line has two campers to choose from, and so no sole camper to tie to.
        person(SAMUEL, JOHNSON, "Samuel", "Johnson", "2016-10-10", alternate_childhood_household=_hh_id(OKAFOR)),
        person(OLIVIA, CHEN, "Olivia", "Chen", "2014-08-30", gender_identity_name="Nonbinary"),
        person(RILEY, SAM, "Riley", "Sam", "1986-06-01"),
        person(MAYA, SAM, "Maya", "Sam", "2019-03-03"),
        person(NOAH, RIVERA, "Noah", "Rivera", "2015-07-07", gender_pronoun_name="he/him"),
        person(AVA, OKAFOR, "Ava", "Okafor", "2016-09-09"),
    ]


def _sessions() -> list[Any]:
    rows = [
        _rec(
            id=_session_id(s.cm_id),
            year=SEASON_YEAR,
            cm_id=s.cm_id,
            name=s.name,
            session_type=s.session_type,
            start_date=s.start_date,
            end_date="",
            parent_id=0,
        )
        for s in SESSIONS
    ]
    rows.append(
        _rec(
            id=_session_id(SUMMER_SESSION, PRIOR_SEASON),
            year=PRIOR_SEASON,
            cm_id=SUMMER_SESSION,
            name="Session 2",
            session_type="main",
            start_date="2026-06-21",
            end_date="",
            parent_id=0,
        )
    )
    return rows


def _attendees() -> list[Any]:
    def attendee(
        key: str, person: int, session: int, status: int, when: str, year: int = SEASON_YEAR
    ) -> SimpleNamespace:
        return _rec(
            id=f"at{key:0>13}",
            year=year,
            person_id=person,
            person=_person_id(person, year),
            status_id=status,
            session=_session_id(session, year),
            enrollment_date=_stamp(when),
            created=_stamp(when),
            updated=_stamp(when),
        )

    return [
        attendee("1", EMMA, SUMMER_SESSION, 2, "2027-02-01"),
        attendee("2", LIAM, TASTE_SESSION, 2, "2027-02-02"),
        attendee("3", OLIVIA, SUMMER_SESSION, 32, "2027-04-10"),  # CampMinder cancelled her registration
        attendee("4", RILEY, FAMILY_CAMP_SESSION, 2, "2027-02-03"),
        attendee("5", MAYA, FAMILY_CAMP_SESSION, 2, "2027-02-03"),
        attendee("6", NOAH, SUMMER_SESSION, 2, "2027-02-04"),
        attendee("7", AVA, SUMMER_SESSION, 2, "2027-02-05"),
        attendee("9", SAMUEL, SUMMER_SESSION, 2, "2027-02-06"),
        attendee("8", EMMA, SUMMER_SESSION, 32, "2026-04-01", PRIOR_SEASON),  # look-alike: a cancelled 2026 Emma
    ]


def _custom_values() -> tuple[list[Any], list[Any]]:
    defs = [
        _rec(id="fd0000000000g01", year=SEASON_YEAR, cm_id=CAMPER_POC_FIELD, name="Camper POC"),
        _rec(id="fd0000000000g02", year=SEASON_YEAR, cm_id=ADULT_POC_FIELD, name="Adult POC"),
        _rec(id="fd0000000000g03", year=SEASON_YEAR, cm_id=UNRELATED_FIELD, name="Unrelated"),
    ]

    def value(key: str, person: int, definition: str, text: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"pv{key:0>13}", year=year, person=_person_id(person, year), field_definition=definition, value=text
        )

    values = [
        value("1", EMMA, "fd0000000000g01", "Yes"),
        value("2", LIAM, "fd0000000000g01", "No"),
        value("3", RILEY, "fd0000000000g02", "yes"),
        value("4", OLIVIA, "fd0000000000g03", "Yes"),  # an unrelated field: never read
        value("5", EMMA, "fd0000000000g01", "No", PRIOR_SEASON),  # look-alike
    ]
    return defs, values


def _applications() -> list[Any]:
    def application(
        cm: int, income: float, members: list[int], year: int = SEASON_YEAR, rid: str = ""
    ) -> SimpleNamespace:
        return _rec(
            id=rid or APP_ID[cm],
            year=year,
            household_cm_id=cm,
            status="active",
            answers={"total_gross_income": income, "expected_gross_income": income},
            member_person_cm_ids=members,
            flags=[],
            created=_stamp(f"{year}-01-20"),
        )

    return [
        application(JOHNSON, 60000.0, [EMMA]),
        application(GARCIA, 45000.0, [LIAM]),
        application(CHEN, 52000.0, [OLIVIA]),
        application(SAM, 70000.0, [RILEY, MAYA]),
        application(RIVERA, 38000.0, [NOAH]),
        application(JOHNSON, 99000.0, [EMMA], PRIOR_SEASON, APP_PRIOR),  # look-alike
    ]


def _requests() -> list[Any]:
    def request(
        rid: str, household: int, person: int, session: int, ask: float, year: int = SEASON_YEAR, **kw: Any
    ) -> SimpleNamespace:
        return _rec(
            id=rid,
            year=year,
            application=kw.pop("application", APP_ID.get(household, "")),
            household_cm_id=household,
            person_cm_id=person,
            session_cm_id=session,
            program_key=kw.pop("program_key", "summer"),
            program_option_text=kw.pop("program_option_text", "Session 2"),
            program_option_key=kw.pop("program_option_key", "session 2"),
            session_resolution="enrollment",
            ask=ask,
            headcount_non_infant=kw.pop("headcount_non_infant", 0),
            headcount_infant=0,
            headcount_source=kw.pop("headcount_source", ""),
            status=kw.pop("status", "active"),
            duplicate_of="",
            flags=[],
            equity=None,
            created=_stamp(f"{year}-01-21"),
        )

    return [
        request(REQ_EMMA, JOHNSON, EMMA, SUMMER_SESSION, 4000.0),
        request(REQ_LIAM, GARCIA, LIAM, TASTE_SESSION, 1500.0, program_option_text="Taste of Camp 1"),
        request(REQ_OLIVIA, CHEN, OLIVIA, SUMMER_SESSION, 3000.0),
        request(
            REQ_SAM,
            SAM,
            0,  # household-level: Family Camp names no camper
            FAMILY_CAMP_SESSION,
            1200.0,
            program_key="family_camp",
            program_option_text="Family Camp 6",
            program_option_key="family camp 6",
            headcount_non_infant=2,
            headcount_source="application",
        ),
        request(REQ_NOAH, RIVERA, NOAH, SUMMER_SESSION, 3500.0),
        request(REQ_PRIOR, JOHNSON, EMMA, SUMMER_SESSION, 9000.0, PRIOR_SEASON, application=APP_PRIOR),  # look-alike
    ]


def _corrections() -> list[Any]:
    def correction(
        key: str, application: str, request: str, name: str, new: str, when: str, year: int = SEASON_YEAR
    ) -> SimpleNamespace:
        return _rec(
            id=f"co{key:0>13}",
            year=year,
            application=application,
            request=request,
            field=name,
            new_value=new,
            original_value="",
            reason="Confirmed with the family",
            actor="registrar@example.com",
            created=_stamp(when),
        )

    return [
        correction("1", APP_ID[JOHNSON], "", "total_gross_income", "58000", "2027-02-10"),
        correction("2", APP_ID[SAM], REQ_SAM, "cost_override", "discount:1000.00", "2027-02-11"),
        correction("3", APP_PRIOR, "", "total_gross_income", "1000", "2026-02-10", PRIOR_SEASON),  # look-alike
    ]


def _payer_shares() -> list[Any]:
    def share(key: str, request: str, household: int, pct: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"sh{key:0>13}",
            year=year,
            request=request,
            household_cm_id=household,
            share_pct=pct,
            source="intake_default" if pct == "100" else "staff",
            actor="system:intake" if pct == "100" else "registrar@example.com",
            note="",
        )

    return [
        share("1", REQ_EMMA, JOHNSON, "100"),
        share("2", REQ_LIAM, GARCIA, "50"),
        share("3", REQ_LIAM, JOHNSON, "50"),  # the childhood household pays half
        share("4", REQ_OLIVIA, CHEN, "100"),
        share("5", REQ_SAM, SAM, "100"),
        share("6", REQ_NOAH, RIVERA, "100"),
        share("7", REQ_PRIOR, JOHNSON, "100", PRIOR_SEASON),  # look-alike
    ]


def _decisions() -> list[Any]:
    def event(
        key: str, request: str, n: int, kind: str, when: str, amount: float = 0.0, year: int = SEASON_YEAR, **kw: Any
    ) -> SimpleNamespace:
        return _rec(
            id=f"de{key:0>13}",
            year=year,
            request=request,
            round=n,
            event=kind,
            amount=amount,
            effective_on=kw.pop("effective_on", ""),
            statement_of_need=kw.pop("statement_of_need", ""),
            decision_type="",
            needs_approval=kw.pop("needs_approval", False),
            lock_source="",
            rules_version=kw.pop("rules_version", 0),
            snapshot=None,
            note="",
            actor="registrar@example.com",
            created=_stamp(when),
        )

    return [
        event("01", REQ_EMMA, 1, "post", "2027-03-08", 1500.0, effective_on="2027-03-08", rules_version=1),
        event("02", REQ_EMMA, 1, "accept", "2027-03-20"),
        event("03", REQ_EMMA, 2, "ask", "2027-04-01", 300.0, effective_on="2027-04-01", statement_of_need="Job loss"),
        event("04", REQ_OLIVIA, 1, "post", "2027-03-08", 1500.0, effective_on="2027-03-08", rules_version=1),
        event("05", REQ_LIAM, 3, "award", "2027-04-02", 250.0, needs_approval=True),
        event("06", REQ_NOAH, 1, "post", "2027-03-09", 1200.0, effective_on="2027-03-09", rules_version=1),
        event("07", REQ_NOAH, 1, "unpost", "2027-03-10"),
        event("09", REQ_PRIOR, 1, "post", "2026-03-08", 7000.0, PRIOR_SEASON, effective_on="2026-03-08"),  # look-alike
    ]


def _holds() -> list[Any]:
    def hold(key: str, request: str, kind: str, code: str, when: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"ho{key:0>13}",
            year=year,
            request=request,
            event=kind,
            code=code,
            note="Waiting on a call back" if kind == "place" else "",
            actor="registrar@example.com",
            fact=None,
            created=_stamp(when),
        )

    return [
        hold("1", REQ_LIAM, "place", "manual_hold", "2027-04-03"),
        hold("2", REQ_NOAH, "place", "manual_hold", "2027-03-01"),
        hold("3", REQ_NOAH, "lift", "manual_hold", "2027-03-02"),
        hold("9", REQ_PRIOR, "place", "manual_hold", "2026-04-03", PRIOR_SEASON),  # look-alike
    ]


def _cancellations() -> list[Any]:
    def cancel(
        key: str, request: str, reason: str, when: str, *, in_kindred: bool, year: int = SEASON_YEAR
    ) -> SimpleNamespace:
        return _rec(
            id=f"ca{key:0>13}",
            year=year,
            request=request,
            event="cancel",
            reason=reason,
            in_kindred=in_kindred,
            note="",
            actor="registrar@example.com",
            created=_stamp(when),
        )

    return [
        cancel("1", REQ_OLIVIA, "medical", "2027-04-11", in_kindred=False),  # the reason for CampMinder's cancel
        cancel("2", REQ_NOAH, "aid_not_enough", "2027-04-12", in_kindred=True),
        cancel("9", REQ_PRIOR, "schedule", "2026-04-12", in_kindred=True, year=PRIOR_SEASON),  # look-alike
    ]


def _postings() -> list[Any]:
    def line(
        txn: int,
        household: int,
        person: int,
        amount: float,
        funder: str,
        source: str,
        family: str,
        posted: str,
        *,
        reversed_on: str = "",
        year: int = SEASON_YEAR,
    ) -> SimpleNamespace:
        return _rec(
            id=f"po{txn:013d}",
            year=year,
            transaction_cm_id=txn,
            household_cm_id=household,
            person_cm_id=person,
            amount=amount,  # CampMinder's sign: aid is a credit
            effective_source_key=source,
            source_key=source,
            source_family=family,
            funder_type=funder,
            post_date=_stamp(posted, 12),
            is_reversed=bool(reversed_on),
            reversal_date=_stamp(reversed_on, 12) if reversed_on else "",
            attribution_method="",
            attributed_person_cm_id=0,
            attributed_session_cm_id=0,
            program_family="",
            flags=[],
            transaction_note="",
            created=_stamp(posted),
            updated=_stamp(reversed_on or posted),
        )

    return [
        line(T_EMMA_CAMP, JOHNSON, EMMA, -1500.0, "camp", "camp aid", "camp", "2027-03-08"),
        # Posted, then reversed by CampMinder after her registration was cancelled: the clawback.
        line(T_CHEN_CAMP, CHEN, OLIVIA, -1500.0, "camp", "camp aid", "camp", "2027-03-08", reversed_on="2027-04-15"),
        line(T_GARCIA_CAMP, GARCIA, 0, -400.0, "camp", "camp aid", "camp", "2027-03-15"),  # placed by an override
        line(T_EMMA_GRANT, JOHNSON, EMMA, -500.0, "outside", "regional grant", "other_outside", "2027-02-20"),
        line(T_OKAFOR_GRANT, OKAFOR, 0, -250.0, "outside", "regional grant", "other_outside", "2027-02-21"),
        line(T_PRIOR, JOHNSON, EMMA, -7000.0, "camp", "camp aid", "camp", "2026-03-08", year=PRIOR_SEASON),
    ]


def _overrides() -> list[Any]:
    def override(key: str, txn: int, person: int, session: int, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"ov{key:0>13}",
            year=year,
            transaction_cm_id=txn,
            attributed_person_cm_id=person,
            attributed_session_cm_id=session,
            program_family="summer",
            source_key_override="",
            source="staff",
            note="",
            split=None,
        )

    return [
        override("1", T_GARCIA_CAMP, LIAM, TASTE_SESSION),
        override("9", T_PRIOR, DANA, SUMMER_SESSION, PRIOR_SEASON),  # look-alike on the same-year-shape txn
    ]


def _links() -> list[Any]:
    def link(
        key: str, household: int, family: str, *, excluded: bool = False, year: int = SEASON_YEAR
    ) -> SimpleNamespace:
        return _rec(
            id=f"li{key:0>13}",
            year=year,
            household_cm_id=household,
            family_key=family,
            excluded=excluded,
            source="staff",
            created=_stamp(f"{year}-01-25"),
            updated=_stamp(f"{year}-01-25"),
        )

    return [
        link("1", JOHNSON, "fam-johnson"),
        link("2", GARCIA, "fam-johnson"),
        link("3", CHEN, "fam-johnson", excluded=True),  # an excluded link joins nobody
        link("9", OKAFOR, "fam-johnson", year=PRIOR_SEASON),  # look-alike: would join Okafor to Johnson
    ]


def _grants_and_registry() -> tuple[list[Any], list[Any], list[Any]]:
    grants = [
        _rec(
            id="gr0000000000001",
            year=SEASON_YEAR,
            grantor_key="regional_fund",
            household_cm_id=RIVERA,
            person_cm_id=NOAH,
            session_cm_id=SUMMER_SESSION,
            program_family="summer",
            amount=300.0,
            committed_on="2027-02-01",
            status="open",
            note="",
            created=_stamp("2027-02-01"),
        ),
        _rec(
            id="gr0000000000009",
            year=PRIOR_SEASON,
            grantor_key="regional_fund",
            household_cm_id=JOHNSON,
            person_cm_id=EMMA,
            session_cm_id=SUMMER_SESSION,
            program_family="summer",
            amount=900.0,
            committed_on="2026-02-01",
            status="open",
            note="",
            created=_stamp("2026-02-01"),
        ),
    ]
    grantors = [
        _rec(
            id="gt0000000000001",
            key="regional_fund",
            name="Regional Fund",
            aliases=[],
            pays_after_camp_aid=False,
            retired_at="",
        ),
    ]
    sources = [
        _rec(
            id="so0000000000001",
            description_key="camp aid",
            description="Camp aid",
            grantor_key="",
            source_family="camp",
            funder_type="camp",
            implied_program_families=[],
        ),
        _rec(
            id="so0000000000002",
            description_key="regional grant",
            description="Regional grant",
            grantor_key="regional_fund",
            source_family="other_outside",
            funder_type="outside",
            implied_program_families=["summer"],
        ),
    ]
    return grants, grantors, sources


def _fa_mirror() -> list[Any]:
    def answer(key: str, person: int, household: int, ohc: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"fa{key:0>13}",
            year=year,
            person_id=person,
            household=_hh_id(household, year),
            one_happy_camper=ohc,
            synagogue_grant="",
        )

    return [
        answer("1", EMMA, JOHNSON, "Yes"),
        answer("2", NOAH, RIVERA, "No"),
        answer("9", EMMA, JOHNSON, "yes", PRIOR_SEASON),  # look-alike
    ]


def _sync_runs() -> list[Any]:
    def run(key: str, service: str, status: str, started: str, year: int = SEASON_YEAR) -> SimpleNamespace:
        return _rec(
            id=f"sr{key:0>13}", service=service, status=status, year=year, trigger="daily", started=_stamp(started, 3)
        )

    return [
        run("1", "aid_postings", "success", "2027-04-20"),
        run("2", "financial_transactions", "success", "2027-04-20"),
        run("3", "aid_postings", "error", "2027-04-25"),  # a failed run covers nothing
        run("4", "financial_transactions", "success", "2027-04-26", 2024),  # outside the window
    ]


def season_pb() -> SeasonPb:
    """A fresh copy of the season: every call builds new records, so two calls never share a row."""
    defs, values = _custom_values()
    grants, grantors, sources = _grants_and_registry()
    tables: dict[str, list[Any]] = {
        "households": _households(),
        "persons": _persons(),
        "camp_sessions": _sessions(),
        "attendees": _attendees(),
        "custom_field_defs": defs,
        "person_custom_values": values,
        "aid_applications": _applications(),
        "aid_requests": _requests(),
        "aid_application_corrections": _corrections(),
        "aid_payer_shares": _payer_shares(),
        "aid_decisions": _decisions(),
        "aid_hold_events": _holds(),
        "aid_cancellations": _cancellations(),
        "aid_grant_placements": [
            _rec(
                id="gp9999999999999",
                year=PRIOR_SEASON,
                grant=f"ledger:{T_PRIOR}",
                household_cm_id=JOHNSON,
                event="place",
                placement={},
                created=_stamp("2026-03-09"),
            )
        ],
        "aid_postings": _postings(),
        "aid_attribution_overrides": _overrides(),
        "aid_household_links": _links(),
        "aid_grants": grants,
        "aid_grantors": grantors,
        "aid_sources": sources,
        "financial_aid_applications": _fa_mirror(),
        "sync_runs": _sync_runs(),
    }
    return SeasonPb(tables=tables)
