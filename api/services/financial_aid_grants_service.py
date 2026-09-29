"""Grants (campership sub-project 6-core): the grantor directory, the register read, camper
placements and hand-entered commitments (spec §8.2; D55–D57, D86).

Every write goes through sub-project 4a's commit_aid_writes: the record and its aid_change_log
row in ONE PocketBase batch. Each method is one staff action and one operation. A save that
changes nothing writes nothing (the helper refuses to log a no-op, which would be a 500).
actor is the real signed-in person (AuthUser.email).

The grantor directory is global, like aid_sources (Decision 7); its writes are logged under the
current season with entity_id = the grantor key.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from api.constants.collections import AID_ATTRIBUTION_OVERRIDES, AID_GRANTORS
from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.schemas.financial_aid_grants import (
    CamperCandidateOut,
    CamperSuggestionOut,
    ExpectedOut,
    GrantorCreate,
    GrantorDescription,
    GrantorOut,
    GrantorSave,
    GrantorsResponse,
    GrantRowOut,
    GrantsResponse,
    NeedsCamperOut,
    PlaceGrantsIn,
    PlaceGrantsOut,
    RequestShareOut,
    UnmappedDescriptionOut,
    WaitingCommitmentOut,
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
    build_register,
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
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes

GRANTOR_FIELDS = ("name", "aliases", "full_coverage", "covers_canteen", "eligibility", "contacts")


class GrantorKeyTakenError(FinancialAidValidationError):
    """A grantor with that key already exists (409)."""


def _grantor_snapshot(record: Any) -> dict[str, Any]:
    return {
        "name": str(record.name or ""),
        "aliases": list(record.aliases or []),
        "full_coverage": bool(record.full_coverage),
        "covers_canteen": str(record.covers_canteen or "unknown"),
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


def _grantor_out(key: str, fields: dict[str, Any], descriptions: list[GrantorDescription]) -> GrantorOut:
    return GrantorOut(key=key, descriptions=descriptions, **fields)


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
        return await asyncio.to_thread(
            commit_aid_writes, self.repo.pb, writes, actor=actor, reason=reason, require_reason=require_reason
        )

    # --- the grantor directory (rules) ------------------------------------------

    async def list_grantors(self) -> GrantorsResponse:
        grantors = await self.repo.fetch_grantors()
        descriptions = _descriptions_by_grantor(await self.repo.fetch_sources())
        rows = [_grantor_out(str(g.key), _grantor_snapshot(g), descriptions.get(str(g.key), [])) for g in grantors]
        return GrantorsResponse(grantors=sorted(rows, key=lambda g: (g.name.lower(), g.key)))

    async def create_grantor(self, body: GrantorCreate, actor: str) -> GrantorOut:
        if await self.repo.get_grantor(body.key) is not None:
            raise GrantorKeyTakenError(f"a grantor with key {body.key!r} already exists")
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
        if changed_fields(before, after) == ({}, {}):
            return _grantor_out(key, before, descriptions)  # nothing to write, nothing to log
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
        return _grantor_out(key, after, descriptions)

    # --- the register read (view) ------------------------------------------------

    async def read(self, year: int) -> GrantsResponse:
        """Grants' one aggregate read (D21): the register, needs attention and Expected, joined
        and computed here; the browser only filters and sorts."""
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
        members = await self.repo.fetch_household_members(year, {x for hs in family_sets.values() for x in hs})
        people = {int(m.cm_id): m for m in members}
        wanted = (
            {ln.person_cm_id for ln in lines}
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
        grantor_by_source = {str(s.description_key): str(getattr(s, "grantor_key", "") or "") for s in sources}
        inputs = RegisterInputs(
            lines=lines,
            placements=placements,
            commitments=commitments,
            grantor_by_source=grantor_by_source,
            enrollments=enrollments,
            requests=requests,
        )
        rows = build_register(inputs)

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

        household_names = {int(h.cm_id): h for h in household_rows}
        grantor_names = {str(g.key): str(g.name) for g in grantors_raw}
        descriptions = {str(s.description_key): s for s in sources}

        def name_of(cm: int) -> str:
            return person_display_name(people[cm]) if cm in people else ""

        def family_of(cm: int) -> str:
            return household_display_name(household_names.get(cm), cm)

        def row_out(row: RegisterRow) -> GrantRowOut:
            source = descriptions.get(row.source_key)
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
        return GrantsResponse(
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
                WaitingCommitmentOut(grant=row_out(w.row), days_waiting=w.days_waiting) for w in attention.waiting
            ],
            expected=[
                ExpectedOut(
                    household_cm_id=e.household_cm_id,
                    family_name=family_of(e.household_cm_id),
                    kind=e.kind,
                    person_cm_ids=list(e.person_cm_ids),
                    camper_names=[name_of(cm) for cm in e.person_cm_ids],
                )
                for e in expected
            ],
        )

    # --- placing a camper (casework) ----------------------------------------------

    async def place(self, year: int, body: PlaceGrantsIn, actor: str) -> PlaceGrantsOut:
        """Confirms campers on grant lines (D16), writing aid_attribution_overrides rows: the one
        placement home, applied by Go on the next aid_postings run and overlaid by read() at once
        (Decision 2). Every placement is checked before anything is written (Decision 11).

        Family membership (Ruling 2): Go's attribution treats a person as belonging to a household
        if it is their own household OR their primary/alternate childhood household, which is
        exactly the pool fetch_household_persons(year, household_ids) returns — so membership is
        "the line's family household set, fetched, and is this person in that set of cm_ids", not
        fetch_household_members + a household_id comparison.
        """
        lines = {int(p.transaction_cm_id): p for p in await self.repo.fetch_grant_postings(year) if not p.is_reversed}
        for p in body.placements:
            if p.transaction_cm_id not in lines:
                raise FinancialAidValidationError(
                    f"transaction {p.transaction_cm_id} is not a live grant line in {year}"
                )
        links = await self.repo.fetch_links(year)
        family_sets: dict[int, frozenset[int]] = {
            p.transaction_cm_id: frozenset(
                family_household_set(links, int(lines[p.transaction_cm_id].household_cm_id or 0))
            )
            for p in body.placements
        }
        unique_families = list(set(family_sets.values()))
        member_lists = await asyncio.gather(*(self.repo.fetch_household_persons(year, fs) for fs in unique_families))
        family_members = {
            fs: {int(m.cm_id) for m in members} for fs, members in zip(unique_families, member_lists, strict=True)
        }
        sessions: dict[int, dict[int, str]] = defaultdict(dict)
        for e in (
            _enrollment(a) for a in await self.repo.fetch_enrollments(year, {p.person_cm_id for p in body.placements})
        ):
            if e is not None:
                sessions[e.person_cm_id][e.session_cm_id] = e.program_family
        existing = {int(o.transaction_cm_id): o for o in await self.repo.fetch_overrides(year)}

        writes: list[AidWrite] = []
        unchanged = 0
        for p in body.placements:
            if p.person_cm_id not in family_members[family_sets[p.transaction_cm_id]]:
                raise FinancialAidValidationError(
                    f"person {p.person_cm_id} is not in the family of transaction {p.transaction_cm_id}"
                )
            enrolled = sessions.get(p.person_cm_id, {})
            if p.session_cm_id is not None:
                if p.session_cm_id not in enrolled:
                    raise FinancialAidValidationError(
                        f"person {p.person_cm_id} has no enrollment in session {p.session_cm_id} in {year} "
                        f"(transaction {p.transaction_cm_id})"
                    )
                family = enrolled[p.session_cm_id]
            else:
                # Go's rule for a person-only override: the family of that person's enrollments
                # when they all share one (spec §6.3, SP4's narrowing).
                families = set(enrolled.values())
                family = families.pop() if len(families) == 1 else ""
            current = existing.get(p.transaction_cm_id)
            payload = {
                "transaction_cm_id": p.transaction_cm_id,
                "year": year,
                "attributed_person_cm_id": p.person_cm_id,
                "attributed_session_cm_id": p.session_cm_id or 0,
                "program_family": family,
                "source_key_override": str(getattr(current, "source_key_override", "") or "") if current else "",
                "source": "staff",
                "note": body.note,
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
