"""Grants (campership sub-project 6-core): the grantor directory, the register read, camper
placements and hand-entered commitments (spec §8.2; D55–D57, D86).

Every write goes through sub-project 4a's commit_aid_writes: the record and its aid_change_log
row in ONE PocketBase batch. Each method is one staff action and one operation. A save that
changes nothing writes nothing (the helper refuses to log a no-op, which would be a 500).
actor is the real signed-in person (AuthUser.email).

The grantor directory is global, like aid_sources (Decision 7); its writes are logged under the
current season with entity_id = the grantor key. Its writes are financial_aid.grantors (owner ruling
2026-10-01). A grantor is RETIRED, never deleted: only once no description maps to it and no open grant
names it; it is then hidden from pickers (list_grantors) and kept for history (every other read).
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Protocol

from api.constants.collections import AID_ATTRIBUTION_OVERRIDES, AID_GRANTORS, AID_GRANTS
from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.schemas.financial_aid_grants import (
    CamperCandidateOut,
    CamperSuggestionOut,
    CommitmentIn,
    CommitmentOut,
    ExpectedOut,
    GrantorCreate,
    GrantorDescription,
    GrantorOut,
    GrantorRetireIn,
    GrantorSave,
    GrantorSeasonOut,
    GrantorsResponse,
    GrantRowOut,
    GrantsResponse,
    NeedsCamperOut,
    PlaceGrantsIn,
    PlaceGrantsOut,
    RequestShareOut,
    UnmappedDescriptionOut,
    WaitingCommitmentOut,
    WithdrawIn,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_grants_register import (
    CamperSuggestion,
    Commitment,
    Enrollment,
    FormAnswer,
    GrantLine,
    Placement,
    RegisterInputs,
    RegisterRow,
    RequestRef,
    applied_households,
    build_register,
    expected_display_names,
    expected_grants,
    needs_attention,
    program_family_for_session_type,
)
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_ledger_service import (
    FinancialAidNotFoundError,
    FinancialAidValidationError,
    aid_dollars,
    family_household_set,
    household_display_name,
    money,
    parse_pb_datetime,
    person_display_name,
)
from api.services.lodging_cache_warm import current_season_year
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import (
    AidOperationResult,
    AidWrite,
    commit_aid_writes,
    new_record_id,
    race_conflict,
)
from bunking.pocketbase_batch import BatchRequestFailedError

GRANTOR_FIELDS = (
    "name",
    "aliases",
    "full_coverage",
    "covers_canteen",
    "pays_after_camp_aid",
    "eligibility",
    "contacts",
)


class GrantorKeyTakenError(FinancialAidValidationError):
    """A grantor with that key already exists (409)."""


class GrantorStateError(FinancialAidValidationError):
    """Retiring a retired grantor, or unretiring one in use (409). Answered before any write, so nothing is logged."""


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


class GrantorInUseError(FinancialAidValidationError):
    """A grantor something still points at can't be retired (409): the counts say what to fix first."""

    def __init__(self, name: str, *, descriptions: int, grants: int) -> None:
        self.descriptions = descriptions
        self.grants = grants
        mapped = (
            _count(descriptions, "CampMinder description still maps", "CampMinder descriptions still map") + " to it"
        )
        named = _count(grants, "open grant still names", "open grants still name") + " it"
        them = "it" if descriptions == 1 else "them"
        grant_them = "it" if grants == 1 else "them"
        if descriptions and grants:
            what = f"{mapped}, and {named}"
            fix = (
                f"Map the {'description' if descriptions == 1 else 'descriptions'} to another grantor and move or "
                f"withdraw the {'grant' if grants == 1 else 'grants'} first."
            )
        elif descriptions:
            what, fix = mapped, f"Map {them} to another grantor first."
        else:
            what, fix = named, f"Move {grant_them} to another grantor or withdraw {grant_them} first."
        super().__init__(f"{name} can't be retired yet: {what}. {fix}")


def grantor_retired_at(record: Any) -> str:
    """Empty for a grantor in use; when it was retired otherwise."""
    return str(getattr(record, "retired_at", "") or "")


def refuse_retired_grantor(record: Any) -> None:
    """A retired grantor takes no new description or grant: either would undo what retiring it checked."""
    if grantor_retired_at(record):
        raise FinancialAidValidationError(f"{record.name} is retired; unretire it first")


def _grantor_snapshot(record: Any) -> dict[str, Any]:
    return {
        "name": str(record.name or ""),
        "aliases": list(record.aliases or []),
        "full_coverage": bool(record.full_coverage),
        "covers_canteen": str(record.covers_canteen or "unknown"),
        "pays_after_camp_aid": bool(record.pays_after_camp_aid),
        "eligibility": str(record.eligibility or ""),
        "contacts": str(record.contacts or ""),
    }


def _descriptions_by_grantor(sources: list[Any]) -> dict[str, list[GrantorDescription]]:
    out: dict[str, list[GrantorDescription]] = defaultdict(list)
    for s in sources:
        key = str(getattr(s, "grantor_key", "") or "")
        if key:
            out[key].append(
                GrantorDescription(
                    source_id=str(s.id),
                    description_key=str(s.description_key),
                    description=str(s.description or ""),
                    source_family=str(s.source_family),
                )
            )
    return {k: sorted(v, key=lambda d: d.description_key) for k, v in out.items()}


def grantor_seasons(year: int, rows: Sequence[RegisterRow]) -> dict[str, GrantorSeasonOut]:
    """Grants › Grantors' "grants / $ this season" (owner question 3, default): each grantor's live CampMinder grant
    lines this season and their net. A reversed line is out (D74). A line still waiting for its camper is in: the
    money is given (D87). A hand-entered commitment is not, until CampMinder posts it (D55)."""
    count: dict[str, int] = defaultdict(int)
    amount: dict[str, Decimal] = defaultdict(Decimal)
    for row in rows:
        if row.kind != "ledger" or row.is_reversed or not row.grantor_key:
            continue
        count[row.grantor_key] += 1
        amount[row.grantor_key] += row.amount
    return {key: GrantorSeasonOut(year=year, count=count[key], amount=money(amount[key])) for key in count}


def _grantor_out(
    key: str, fields: dict[str, Any], descriptions: list[GrantorDescription], retired_at: str = ""
) -> GrantorOut:
    return GrantorOut(key=key, descriptions=descriptions, retired_at=retired_at, **fields)


# --- the register read: record -> dataclass converters -----------------------------


def _expanded(record: Any, name: str) -> Any | None:
    return (getattr(record, "expand", None) or {}).get(name)


def _line(p: Any) -> GrantLine:
    return GrantLine(
        transaction_cm_id=int(p.transaction_cm_id),
        household_cm_id=int(p.household_cm_id or 0),
        person_cm_id=int(p.person_cm_id or 0),
        amount=aid_dollars(p.amount),
        source_key=str(p.effective_source_key or p.source_key),
        source_family=str(p.source_family or ""),
        funder_type=str(p.funder_type or ""),
        post_date=str(p.post_date or ""),
        is_reversed=bool(p.is_reversed),
        reversal_date=str(p.reversal_date or ""),
        attribution_method=str(p.attribution_method or ""),
        attributed_person_cm_id=int(p.attributed_person_cm_id or 0),
        attributed_session_cm_id=int(p.attributed_session_cm_id or 0),
        program_family=str(p.program_family or ""),
    )


def _placement(o: Any) -> Placement | None:
    """Only an override that names a person confirms a camper; a reclassify-only override doesn't."""
    person = int(o.attributed_person_cm_id or 0)
    if person <= 0:
        return None
    return Placement(
        int(o.transaction_cm_id), person, int(o.attributed_session_cm_id or 0), str(o.program_family or "")
    )


def _commitment(c: Any) -> Commitment:
    return Commitment(
        id=str(c.id),
        grantor_key=str(c.grantor_key),
        household_cm_id=int(c.household_cm_id),
        person_cm_id=int(c.person_cm_id),
        session_cm_id=int(c.session_cm_id or 0),
        program_family=str(c.program_family or ""),
        amount=Decimal(str(c.amount)),
        committed_on=date.fromisoformat(str(c.committed_on)[:10]),
        created=parse_pb_datetime(getattr(c, "created", "")),
        status=str(c.status),
        note=str(getattr(c, "note", "") or ""),
    )


def _enrollment(a: Any) -> Enrollment | None:
    session = _expanded(a, "session")
    if session is None:
        return None
    family = program_family_for_session_type(str(getattr(session, "session_type", "") or ""))
    return Enrollment(int(a.person_id), int(session.cm_id), family, int(a.status_id or 0))


def _is_yes(value: Any) -> bool:
    return str(value or "").strip().lower() == "yes"


def _override_snapshot(o: Any) -> dict[str, Any]:
    return {
        "transaction_cm_id": int(o.transaction_cm_id),
        "year": int(o.year),
        "attributed_person_cm_id": int(o.attributed_person_cm_id or 0),
        "attributed_session_cm_id": int(o.attributed_session_cm_id or 0),
        "program_family": str(o.program_family or ""),
        "source_key_override": str(o.source_key_override or ""),
        "source": str(o.source or ""),
        "note": str(o.note or ""),
    }


def _with_suggested_camper(
    candidates: tuple[int, ...], suggestion: CamperSuggestion | None, active: set[int], people: dict[int, Any]
) -> tuple[int, ...]:
    """Ruling 2b: the suggestion's person is always a candidate when they're enrolled this season,
    even when their own household isn't the line's (fetch_household_members' pool is own-household
    only, but attribution can name someone linked in only via a childhood household)."""
    if suggestion is None or suggestion.person_cm_id not in active or suggestion.person_cm_id in candidates:
        return candidates
    return tuple(sorted((*candidates, suggestion.person_cm_id), key=lambda cm: (person_display_name(people[cm]), cm)))


# --- hand-entered commitments (casework) ----------------------------------------------------


def _commitment_snapshot(c: Any) -> dict[str, Any]:
    return {
        "grantor_key": str(c.grantor_key),
        "household_cm_id": int(c.household_cm_id),
        "person_cm_id": int(c.person_cm_id),
        "session_cm_id": int(c.session_cm_id or 0),
        "program_family": str(c.program_family or ""),
        "amount": float(c.amount),
        "committed_on": str(c.committed_on)[:10],
        "note": str(c.note or ""),
    }


def _commitment_out(record_id: str, year: int, fields: dict[str, Any], status: str, withdrawn_at: str) -> CommitmentOut:
    return CommitmentOut(id=record_id, year=year, status=status, withdrawn_at=withdrawn_at, **fields)


def _program_family(enrolled: Sequence[Enrollment], session_cm_id: int | None) -> str | None:
    """The program-family rule place() and _commitment_fields() share (Ruling 1/2): an
    explicit session accepts an enrollment of ANY status -- a grant or commitment may belong to a
    session the camper later cancelled -- and takes that session's family. With no session, only
    ACTIVE enrollments (ACTIVE_ENROLLED_STATUS_ID) count toward the family, and only when they all
    name one: a cancelled enrollment in a different program family must never manufacture an
    ambiguous "". Returns None only when an explicit session names no enrollment at all; the
    caller raises with its own message (the two callers' wording differs). place() alone then
    breaks a "" with the line's own program (owner ruling 2026-09-29); a commitment has no line."""
    if session_cm_id is not None:
        match = next((e for e in enrolled if e.session_cm_id == session_cm_id), None)
        return match.program_family if match is not None else None
    families = {e.program_family for e in enrolled if e.status_id == ACTIVE_ENROLLED_STATUS_ID}
    return families.pop() if len(families) == 1 else ""


@dataclass(frozen=True)
class _Loaded:
    """Everything the register read loads, and the register built from it (register_rows reuses it)."""

    inputs: RegisterInputs
    rows: list[RegisterRow]
    sources: list[Any]
    grantors: list[Any]
    answers: list[FormAnswer]
    family_sets: dict[int, list[int]]
    members: list[Any]
    people: dict[int, Any]
    enrollments: list[Enrollment]
    session_names: dict[int, str]
    household_rows: list[Any]


class GrantsService:
    def __init__(self, repo: GrantsRepository, *, clock: Callable[[], datetime] | None = None) -> None:
        self.repo = repo
        self._clock = clock or (lambda: datetime.now(UTC))

    def _today(self) -> date:
        """Today in camp time (a commitment's days waiting; spec §6.2's camp-time dates)."""
        return self._clock().astimezone(CAMP_TZ).date()

    async def _commit(
        self, writes: list[AidWrite], *, actor: str, reason: str | None, require_reason: bool = False
    ) -> AidOperationResult:
        """One operation. A batch that lost a race (a grantor key or a line's placement someone created first, a
        record someone removed first) is G6's AidWriteConflictError, answered 409: nothing was written; reload and
        try again. Any other refused batch goes through as it is."""
        try:
            return await asyncio.to_thread(
                commit_aid_writes, self.repo.pb, writes, actor=actor, reason=reason, require_reason=require_reason
            )
        except BatchRequestFailedError as exc:
            if (conflict := race_conflict(exc)) is not None:
                raise conflict from exc
            raise

    async def _family_members(
        self, year: int, links: Any, household_cm_ids: Collection[int]
    ) -> dict[int, frozenset[int]]:
        """The family-membership rule place(), _commitment_fields() and the register's D142 tie share (Ruling 1/2):
        Go's attribution treats a person as belonging to a household if it is their own household
        OR their primary/alternate childhood household, across the household's linked family
        (family_household_set) -- never fetch_household_members plus a plain household_id
        comparison. One repository call for every household asked (SP6-core T7)."""
        if not household_cm_ids:
            return {}
        family_sets = {h: frozenset(family_household_set(links, h)) for h in household_cm_ids}
        by_household = await self.repo.fetch_household_persons_by_household(year, set().union(*family_sets.values()))
        return {
            h: frozenset(int(p.cm_id) for member in hs for p in by_household.get(member, ()))
            for h, hs in family_sets.items()
        }

    # --- the grantor directory (financial_aid.grantors) ------------------------------

    async def list_grantors(self, *, include_retired: bool = False, year: int | None = None) -> GrantorsResponse:
        """The directory. Retired grantors are left out (pickers never offer one) unless include_retired. With `year`,
        each grantor carries its season's grant lines (grantor_seasons); without it the register is never read."""
        grantors = [g for g in await self.repo.fetch_grantors() if include_retired or not grantor_retired_at(g)]
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources())
        seasons = grantor_seasons(year, await self.register_rows(year)) if year is not None else {}

        def season(key: str) -> GrantorSeasonOut | None:
            if year is None:
                return None
            return seasons.get(key, GrantorSeasonOut(year=year, count=0, amount=0.0))

        rows = [
            _grantor_out(
                str(g.key), _grantor_snapshot(g), descriptions.get(str(g.key), []), grantor_retired_at(g)
            ).model_copy(update={"season": season(str(g.key))})
            for g in grantors
        ]
        return GrantorsResponse(grantors=sorted(rows, key=lambda g: (g.name.lower(), g.key)))

    async def create_grantor(self, body: GrantorCreate, actor: str) -> GrantorOut:
        existing = await self.repo.get_grantor(body.key)
        if existing is not None:
            retired = " (retired; unretire it instead)" if grantor_retired_at(existing) else ""
            raise GrantorKeyTakenError(f"a grantor with key {body.key!r} already exists{retired}")
        fields = body.model_dump(include=set(GRANTOR_FIELDS))
        season = await current_season_year(self.repo.pb)  # the directory spans seasons; log the current one
        write = AidWrite(
            collection=AID_GRANTORS,
            action="create",
            year=season,
            data={"key": body.key, **fields, "note": body.note},
            after={"key": body.key, **fields},
            entity_id=body.key,
        )
        await self._commit([write], actor=actor, reason=body.note)
        return _grantor_out(body.key, fields, [])

    async def save_grantor(self, key: str, body: GrantorSave, actor: str) -> GrantorOut:
        current = await self.repo.get_grantor(key)
        if current is None:
            raise FinancialAidNotFoundError(f"grantor {key!r} not found")
        before = _grantor_snapshot(current)
        after = body.model_dump(include=set(GRANTOR_FIELDS))
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources()).get(key, [])
        retired_at = grantor_retired_at(current)  # a retired grantor's facts can still be corrected
        if changed_fields(before, after) == ({}, {}):
            return _grantor_out(key, before, descriptions, retired_at)  # nothing to write, nothing to log
        season = await current_season_year(self.repo.pb)
        write = AidWrite(
            collection=AID_GRANTORS,
            action="update",
            year=season,
            record_id=str(current.id),
            before=before,
            data={**after, "note": body.note},
            after=after,
            entity_id=key,
        )
        await self._commit([write], actor=actor, reason=body.note)
        return _grantor_out(key, after, descriptions, retired_at)

    async def retire_grantor(self, key: str, body: GrantorRetireIn, actor: str) -> GrantorOut:
        """Owner ruling 2026-10-01: only once no description maps to the grantor and no open grant names it
        (GrantorInUseError says how many of each). Retiring a retired grantor is refused (GrantorStateError)
        before any write, so the helper never sees a no-op.

        Known limit: the in-use counts are read before the write batch, and aid_sources/aid_grants carry no
        revision to guard on, so a remap or new grant racing a retire can leave a retired grantor still named.
        Nothing is lost (history still resolves it) and unretire repairs it; with a handful of staff the window
        is tiny, so it is accepted rather than adding revision fields."""
        current = await self.repo.get_grantor(key)
        if current is None:
            raise FinancialAidNotFoundError(f"grantor {key!r} not found")
        if grantor_retired_at(current):
            raise GrantorStateError(f"{current.name} is already retired")
        sources, open_grants = await asyncio.gather(
            self.repo.fetch_sources(), self.repo.fetch_open_commitments_naming(key)
        )
        mapped = sum(1 for s in sources if str(getattr(s, "grantor_key", "") or "") == key)
        if mapped or open_grants:
            raise GrantorInUseError(str(current.name), descriptions=mapped, grants=len(open_grants))
        retired_at = self._clock().astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S.000Z")
        await self._set_retired_at(current, key, retired_at, "retire", body.reason, actor)
        return _grantor_out(key, _grantor_snapshot(current), [], retired_at)

    async def unretire_grantor(self, key: str, body: GrantorRetireIn, actor: str) -> GrantorOut:
        """Puts a retired grantor back in the pickers (development trues up the directory after the seed, and a
        retire can be a mistake). Same permission, a reason required and logged; an active one is refused."""
        current = await self.repo.get_grantor(key)
        if current is None:
            raise FinancialAidNotFoundError(f"grantor {key!r} not found")
        if not grantor_retired_at(current):
            raise GrantorStateError(f"{current.name} isn't retired")
        await self._set_retired_at(current, key, "", "unretire", body.reason, actor)
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources()).get(key, [])
        return _grantor_out(key, _grantor_snapshot(current), descriptions)

    async def _set_retired_at(
        self, current: Any, key: str, retired_at: str, log_action: str, reason: str, actor: str
    ) -> None:
        season = await current_season_year(self.repo.pb)  # the directory spans seasons; log the current one
        write = AidWrite(
            collection=AID_GRANTORS,
            action="update",
            year=season,
            record_id=str(current.id),
            before={"retired_at": grantor_retired_at(current)},
            data={"retired_at": retired_at, "note": reason},
            after={"retired_at": retired_at},
            log_action=log_action,
            entity_id=key,
        )
        await self._commit([write], actor=actor, reason=reason, require_reason=True)

    # --- the register read (view) ------------------------------------------------

    async def _load(self, year: int) -> _Loaded:
        """The register read's loads and the register built from them (spec §8.2)."""
        (
            postings,
            commitments_raw,
            sources,
            grantors_raw,
            overrides,
            links,
            request_raw,
            answers_raw,
        ) = await asyncio.gather(
            self.repo.fetch_grant_postings(year),
            self.repo.fetch_commitments(year),
            self.repo.fetch_sources(),
            self.repo.fetch_grantors(),
            self.repo.fetch_overrides(year),
            self.repo.fetch_links(year),
            self.repo.fetch_request_refs(year),
            self.repo.fetch_grant_answers(year),
        )
        lines = [_line(p) for p in postings]
        placements = {p.transaction_cm_id: p for p in (_placement(o) for o in overrides) if p is not None}
        commitments = [_commitment(c) for c in commitments_raw]
        answers = [
            FormAnswer(
                person_cm_id=int(a.person_id or 0),
                household_cm_id=int(getattr(_expanded(a, "household"), "cm_id", 0) or 0),
                one_happy_camper=_is_yes(a.one_happy_camper),
                synagogue=_is_yes(a.synagogue_grant),
            )
            for a in answers_raw
        ]
        households = (
            {ln.household_cm_id for ln in lines}
            | {c.household_cm_id for c in commitments}
            | {a.household_cm_id for a in answers}
        )
        households.discard(0)
        family_sets = {h: family_household_set(links, h) for h in households}
        requests = [
            RequestRef(
                str(r.id),
                int(r.household_cm_id or 0),
                int(r.person_cm_id or 0),
                int(r.session_cm_id or 0),
                str(r.status),
            )
            for r in request_raw
        ]
        family_households = {h: frozenset(hs) for h, hs in family_sets.items()}
        # D142 ties a never-applied household's line only when it has exactly one camper, so it counts
        # by the membership rule Go's attribution and place() use (own OR childhood household); the
        # own-household pool alone could miss a second camper and tie by guesswork. That pool costs a
        # query per few households, so it is read only where a line could tie: unplaced, and in a
        # family that never applied (build_register decides the rest).
        applied = applied_households(requests, family_households)
        may_tie = {
            ln.household_cm_id
            for ln in lines
            if ln.transaction_cm_id not in placements and ln.household_cm_id not in applied
        } - {0}
        members, household_people = await asyncio.gather(
            self.repo.fetch_household_members(year, {x for hs in family_sets.values() for x in hs}),
            self._family_members(year, links, may_tie),
        )
        people = {int(m.cm_id): m for m in members}
        wanted = (
            set().union(*household_people.values())
            | {ln.person_cm_id for ln in lines}
            | {ln.attributed_person_cm_id for ln in lines}
            | {p.person_cm_id for p in placements.values()}
            | {c.person_cm_id for c in commitments}
            | {a.person_cm_id for a in answers}
        ) - {0}
        missing = wanted - set(people)
        if missing:
            people.update({int(p.cm_id): p for p in await self.repo.fetch_persons(year, missing)})
        attendees, household_rows = await asyncio.gather(
            self.repo.fetch_enrollments(year, set(people)),
            self.repo.fetch_households(year, households),
        )
        enrollments = [e for e in (_enrollment(a) for a in attendees) if e is not None]
        session_names = {
            int(s.cm_id): str(getattr(s, "name", "") or "")
            for s in (_expanded(a, "session") for a in attendees)
            if s is not None
        }
        grantor_by_source = {str(s.description_key): str(getattr(s, "grantor_key", "") or "") for s in sources}
        inputs = RegisterInputs(
            lines=lines,
            placements=placements,
            commitments=commitments,
            grantor_by_source=grantor_by_source,
            enrollments=enrollments,
            requests=requests,
            pays_after_grantors=frozenset(str(g.key) for g in grantors_raw if g.pays_after_camp_aid),
            household_people=household_people,
            family_households=family_households,
            families_by_source={
                str(s.description_key): frozenset(str(f) for f in (getattr(s, "implied_program_families", None) or []))
                for s in sources
            },
        )
        rows = build_register(inputs)
        return _Loaded(
            inputs=inputs,
            rows=rows,
            sources=sources,
            grantors=grantors_raw,
            answers=answers,
            family_sets=family_sets,
            members=members,
            people=people,
            enrollments=enrollments,
            session_names=session_names,
            household_rows=household_rows,
        )

    async def register_rows(self, year: int) -> list[RegisterRow]:
        """The register's rows for sub-project 10a: the calculator's grants bridge
        (`grant_inputs_by_request`) and the budget's outside grants (`outside_grants_by_request`,
        which keeps a pays-after-camp-aid grant the bridge leaves out, D143). The rows read() reports."""
        return (await self._load(year)).rows

    async def read(self, year: int) -> GrantsResponse:
        """Grants' one aggregate read (D21): the register, needs attention and Expected, joined
        and computed here; the browser only filters and sorts."""
        return (await self.read_with_rows(year))[0]

    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[RegisterRow]]:
        """The read and the register rows it was built from, from one load (slice 1: Today and the
        household page price the season with the rows and show the read)."""
        loaded = await self._load(year)
        inputs, rows, sources, grantors_raw = loaded.inputs, loaded.rows, loaded.sources, loaded.grantors
        answers, family_sets, members, people = loaded.answers, loaded.family_sets, loaded.members, loaded.people
        enrollments, session_names, household_rows = loaded.enrollments, loaded.session_names, loaded.household_rows

        active = {e.person_cm_id for e in enrollments if e.status_id == ACTIVE_ENROLLED_STATUS_ID}
        candidates = {
            h: tuple(
                sorted(
                    (int(m.cm_id) for m in members if int(m.household_id or 0) in hs and int(m.cm_id) in active),
                    key=lambda cm: (person_display_name(people[cm]), cm),
                )
            )
            for h, hs in family_sets.items()
        }
        attention = needs_attention(rows, inputs, candidates=candidates, today=self._today())
        grantor_families: dict[str, set[str]] = defaultdict(set)
        for s in sources:
            if getattr(s, "grantor_key", ""):
                grantor_families[str(s.grantor_key)].add(str(s.source_family))
        expected = expected_grants(answers, rows, {k: frozenset(v) for k, v in grantor_families.items()})
        active_names = {str(g.key): str(g.name) for g in grantors_raw if not grantor_retired_at(g)}
        display = expected_display_names({k: frozenset(v) for k, v in grantor_families.items()}, active_names)

        household_names = {int(h.cm_id): h for h in household_rows}
        grantor_names = {str(g.key): str(g.name) for g in grantors_raw}
        descriptions = {str(s.description_key): s for s in sources}

        def name_of(cm: int) -> str:
            return person_display_name(people[cm]) if cm in people else ""

        def family_of(cm: int) -> str:
            return household_display_name(household_names.get(cm), cm)

        commitments = {c.id: c for c in inputs.commitments}

        def row_out(row: RegisterRow) -> GrantRowOut:
            source = descriptions.get(row.source_key)
            commitment = commitments.get(row.commitment_id)
            return GrantRowOut(
                kind=row.kind,
                transaction_cm_id=row.transaction_cm_id,
                commitment_id=row.commitment_id,
                household_cm_id=row.household_cm_id,
                family_name=family_of(row.household_cm_id),
                person_cm_id=row.person_cm_id,
                camper_name=name_of(row.person_cm_id),
                camper_basis=row.camper_basis,
                session_cm_id=row.session_cm_id,
                session_name=session_names.get(row.session_cm_id, ""),
                program_family=row.program_family,
                grantor_key=row.grantor_key,
                grantor_name=grantor_names.get(row.grantor_key, ""),
                description=str(source.description or "") if source is not None else "",
                source_family=row.source_family,
                funder_type=row.funder_type,
                amount=money(row.amount),
                recorded_on=row.recorded_on,
                is_reversed=row.is_reversed,
                reversal_date=row.reversal_date,
                cancelled=row.cancelled,
                counts=row.counts,
                fulfils_commitment_id=row.fulfils_commitment_id,
                requests=[RequestShareOut(request_id=s.request_id, amount=money(s.amount)) for s in row.requests],
                committed_on=commitment.committed_on.isoformat() if commitment is not None else "",
                commitment_note=commitment.note if commitment is not None else "",
            )

        grants = sorted(
            (row_out(r) for r in rows),
            key=lambda r: (
                r.family_name.lower(),
                r.household_cm_id,
                r.recorded_on,
                r.transaction_cm_id,
                r.commitment_id,
            ),
        )
        response = GrantsResponse(
            year=year,
            grants=grants,
            needs_camper=[
                NeedsCamperOut(
                    grant=row_out(n.row),
                    household_applied=n.household_applied,
                    suggestion=(
                        CamperSuggestionOut(
                            person_cm_id=n.suggestion.person_cm_id,
                            camper_name=name_of(n.suggestion.person_cm_id),
                            session_cm_id=n.suggestion.session_cm_id,
                            program_family=n.suggestion.program_family,
                            basis=n.suggestion.basis,
                            method=n.suggestion.method,
                            commitment_id=n.suggestion.commitment_id,
                            amount_matches=n.suggestion.amount_matches,
                        )
                        if n.suggestion is not None
                        else None
                    ),
                    candidates=[
                        CamperCandidateOut(person_cm_id=cm, name=name_of(cm))
                        for cm in _with_suggested_camper(n.candidates, n.suggestion, active, people)
                    ],
                )
                for n in attention.needs_camper
            ],
            unmapped=[
                UnmappedDescriptionOut(
                    source_id=str(descriptions[u.source_key].id) if u.source_key in descriptions else "",
                    description_key=u.source_key,
                    description=str(descriptions[u.source_key].description or "")
                    if u.source_key in descriptions
                    else "",
                    lines=u.lines,
                    amount=money(u.amount),
                )
                for u in attention.unmapped
            ],
            waiting=[
                WaitingCommitmentOut(
                    grant=row_out(w.row),
                    days_waiting=w.days_waiting,
                    reason=w.reason,
                    transaction_cm_id=w.transaction_cm_id,
                )
                for w in attention.waiting
            ],
            expected=[
                ExpectedOut(
                    household_cm_id=e.household_cm_id,
                    family_name=family_of(e.household_cm_id),
                    kind=e.kind,
                    person_cm_ids=list(e.person_cm_ids),
                    camper_names=[name_of(cm) for cm in e.person_cm_ids],
                    display_name=display.get(e.kind),
                )
                for e in expected
            ],
        )
        return response, rows

    # --- placing a camper (casework) ----------------------------------------------

    async def place(self, year: int, body: PlaceGrantsIn, actor: str) -> PlaceGrantsOut:
        """Confirms campers on grant lines (D16), writing aid_attribution_overrides rows: the one
        placement home, applied by Go on the next aid_postings run and overlaid by read() at once
        (Decision 2). Every placement is checked before anything is written (Decision 11).

        Family membership and program-family resolution follow `_family_members` and
        `_program_family` (Ruling 1/2) -- the same rules `_commitment_fields` uses -- except that a
        person-only placement whose camper names no single family keeps the line's own program.
        """
        lines = {int(p.transaction_cm_id): p for p in await self.repo.fetch_grant_postings(year) if not p.is_reversed}
        for p in body.placements:
            if p.transaction_cm_id not in lines:
                raise FinancialAidValidationError(
                    f"transaction {p.transaction_cm_id} is not a live grant line in {year}"
                )
        links = await self.repo.fetch_links(year)
        households = {int(lines[p.transaction_cm_id].household_cm_id or 0) for p in body.placements}
        family_members = await self._family_members(year, links, households)
        enrollments_by_person: dict[int, list[Enrollment]] = defaultdict(list)
        for e in (
            _enrollment(a) for a in await self.repo.fetch_enrollments(year, {p.person_cm_id for p in body.placements})
        ):
            if e is not None:
                enrollments_by_person[e.person_cm_id].append(e)
        existing = {int(o.transaction_cm_id): o for o in await self.repo.fetch_overrides(year)}

        writes: list[AidWrite] = []
        unchanged = 0
        for p in body.placements:
            household_cm_id = int(lines[p.transaction_cm_id].household_cm_id or 0)
            if p.person_cm_id not in family_members[household_cm_id]:
                raise FinancialAidValidationError(
                    f"person {p.person_cm_id} is not in the family of transaction {p.transaction_cm_id}"
                )
            enrolled = enrollments_by_person.get(p.person_cm_id, [])
            family = _program_family(enrolled, p.session_cm_id)
            if family == "":
                # Owner ruling 2026-09-29: a camper active in two programs names no single family,
                # and "" would spread the grant across every program. The line's own program
                # wins when the camper is actively enrolled in it.
                line_family = str(lines[p.transaction_cm_id].program_family or "")
                if any(e.program_family == line_family and e.status_id == ACTIVE_ENROLLED_STATUS_ID for e in enrolled):
                    family = line_family
            if family is None:
                raise FinancialAidValidationError(
                    f"person {p.person_cm_id} has no enrollment in session {p.session_cm_id} in {year} "
                    f"(transaction {p.transaction_cm_id})"
                )
            current = existing.get(p.transaction_cm_id)
            existing_note = str(getattr(current, "note", "") or "") if current else ""
            payload = {
                "transaction_cm_id": p.transaction_cm_id,
                "year": year,
                "attributed_person_cm_id": p.person_cm_id,
                "attributed_session_cm_id": p.session_cm_id or 0,
                "program_family": family,
                "source_key_override": str(getattr(current, "source_key_override", "") or "") if current else "",
                "source": "staff",
                # Ruling: an empty placement note is a tick, not an erasure — it keeps whatever
                # note the override already carried; a non-empty one still replaces it.
                "note": body.note or existing_note,
            }
            if current is None:
                writes.append(
                    AidWrite(
                        collection=AID_ATTRIBUTION_OVERRIDES,
                        action="create",
                        year=year,
                        data={**payload, "actor": actor},
                        after=payload,
                        log_action="place_grant",
                    )
                )
                continue
            before = _override_snapshot(current)
            if changed_fields(before, payload) == ({}, {}):
                unchanged += 1
                continue
            writes.append(
                AidWrite(
                    collection=AID_ATTRIBUTION_OVERRIDES,
                    action="update",
                    year=year,
                    record_id=str(current.id),
                    before=before,
                    data={**payload, "actor": actor},
                    after=payload,
                    log_action="place_grant",
                )
            )
        if not writes:
            return PlaceGrantsOut(year=year, placed=0, unchanged=unchanged, operation_id=None)
        result = await self._commit(writes, actor=actor, reason=body.note or None)
        return PlaceGrantsOut(year=year, placed=len(writes), unchanged=unchanged, operation_id=result.operation_id)

    # --- hand-entered commitments (casework) --------------------------------------

    async def _commitment_fields(self, year: int, body: CommitmentIn) -> dict[str, Any]:
        """Checks a commitment against the directory and the season, and resolves its program
        family. Membership and family inference mirror place()'s ruled pattern exactly (Ruling
        1/2), via the same `_family_members` and `_program_family` helpers."""
        grantor = await self.repo.get_grantor(body.grantor_key)
        if grantor is None:
            raise FinancialAidNotFoundError(f"grantor {body.grantor_key!r} not found")
        refuse_retired_grantor(grantor)
        funders = {
            str(s.funder_type)
            for s in await self.repo.fetch_sources()
            if getattr(s, "grantor_key", "") == body.grantor_key
        }
        if funders == {"incentive"}:
            # Decision 4: a family incentive posts in CampMinder directly and the rules don't price it
            # (incentives were culled, §9.9); counted as a commitment it would offset like a grant.
            raise FinancialAidValidationError(
                "a family incentive isn't entered as a commitment; it posts in CampMinder"
            )
        links = await self.repo.fetch_links(year)
        members = (await self._family_members(year, links, {body.household_cm_id}))[body.household_cm_id]
        if body.person_cm_id not in members:
            raise FinancialAidValidationError(
                f"person {body.person_cm_id} is not in household {body.household_cm_id}'s family"
            )
        enrollments = [
            e
            for e in (_enrollment(a) for a in await self.repo.fetch_enrollments(year, {body.person_cm_id}))
            if e is not None
        ]
        family = _program_family(enrollments, body.session_cm_id)
        if family is None:
            raise FinancialAidValidationError(
                f"person {body.person_cm_id} has no enrollment in session {body.session_cm_id}"
            )
        return {
            "grantor_key": body.grantor_key,
            "household_cm_id": body.household_cm_id,
            "person_cm_id": body.person_cm_id,
            "session_cm_id": body.session_cm_id or 0,
            "program_family": family,
            "amount": float(body.amount),
            "committed_on": body.committed_on.isoformat(),
            "note": body.note,
        }

    async def _open_commitment(self, year: int, commitment_id: str) -> Any:
        current = await self.repo.get_commitment(commitment_id)
        if current is None or int(current.year) != year:
            raise FinancialAidNotFoundError(f"commitment {commitment_id} not found in {year}")
        return current

    async def create_commitment(self, year: int, body: CommitmentIn, actor: str) -> CommitmentOut:
        fields = await self._commitment_fields(year, body)
        record_id = new_record_id()
        write = AidWrite(
            collection=AID_GRANTS,
            action="create",
            year=year,
            record_id=record_id,
            data={"year": year, **fields, "status": "open", "withdrawn_at": "", "actor": actor},
            after={**fields, "status": "open"},
        )
        await self._commit([write], actor=actor, reason=body.note or None)
        return _commitment_out(record_id, year, fields, "open", "")

    async def save_commitment(self, year: int, commitment_id: str, body: CommitmentIn, actor: str) -> CommitmentOut:
        current = await self._open_commitment(year, commitment_id)
        if str(current.status) != "open":
            raise FinancialAidValidationError("a withdrawn commitment can't be edited")
        fields = await self._commitment_fields(year, body)
        before = _commitment_snapshot(current)
        if changed_fields(before, fields) == ({}, {}):
            return _commitment_out(commitment_id, year, before, "open", "")  # nothing to write, nothing to log
        write = AidWrite(
            collection=AID_GRANTS,
            action="update",
            year=year,
            record_id=commitment_id,
            before=before,
            data={**fields, "actor": actor},
            after=fields,
        )
        await self._commit([write], actor=actor, reason=body.note or None)
        return _commitment_out(commitment_id, year, fields, "open", "")

    async def withdraw_commitment(self, year: int, commitment_id: str, body: WithdrawIn, actor: str) -> CommitmentOut:
        """A cancel: the reason is required (Decision 12). "Fulfilled" is never stored; a
        commitment a line has fulfilled simply stops appearing (Decision 4)."""
        current = await self._open_commitment(year, commitment_id)
        if str(current.status) == "withdrawn":
            raise FinancialAidValidationError("this commitment is already withdrawn")
        withdrawn_at = self._clock().astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S.000Z")
        write = AidWrite(
            collection=AID_GRANTS,
            action="update",
            year=year,
            record_id=commitment_id,
            before={"status": "open", "withdrawn_at": ""},
            data={"status": "withdrawn", "withdrawn_at": withdrawn_at, "actor": actor},
            log_action="withdraw",
        )
        await self._commit([write], actor=actor, reason=body.reason, require_reason=True)
        return _commitment_out(commitment_id, year, _commitment_snapshot(current), "withdrawn", withdrawn_at)


class GrantsLoader(Protocol):
    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[RegisterRow]]: ...


class OneGrantsLoad:
    """One season's grants load, shared by the register a season is priced with (the decisions service's
    RegisterSource) and the grants read a surface shows (slice 1: Today and the household page), so a
    surface never loads the register twice."""

    def __init__(self, grants: GrantsLoader, year: int) -> None:
        self._grants = grants
        self._year = year
        self._loading: asyncio.Future[tuple[GrantsResponse, list[RegisterRow]]] | None = None

    async def read(self) -> tuple[GrantsResponse, list[RegisterRow]]:
        if self._loading is None:
            self._loading = asyncio.ensure_future(self._grants.read_with_rows(self._year))
        return await self._loading

    async def register(self, year: int) -> list[RegisterRow]:
        if year != self._year:
            raise ValueError(f"this grants load is for {self._year}, not {year}")
        return (await self.read())[1]
