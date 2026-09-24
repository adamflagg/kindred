"""The camper journey, merged on the server (kindred#2776).

Lists every prior year a person was ENROLLED on a journey session type
(summer + teen + family + adult, #2113), labelling each row with its housing
when known: the bunk for a summer session; the household's cabin for a family
weekend (never the CampMinder day group, kindred#2466); the attributed cabin
for an adult weekend; the registry-resolved cabin for TLI/SCIT (Q9). Sourcing
from attendees rather than bunk assignments is what surfaces 2022 (a
CampMinder export gap), teens and family camp uniformly.

This is a PORT, not a redesign. The rules below were `fetchCamperJourney` and
`personJourneyFacts` on the client until kindred#2776, and their tests moved
with them one for one (`tests/unit/api/services/test_camper_journey_service.py`
carries the mapping). What the port removes is the plumbing: the client pulled
every family year's adults and children to read one cabin label per year, and
had to key its feed on facts (adulthood, household) that were easy to leave
out.

AG is never shown as its own session: a Main+AG same-year pair collapses to
the Main row, and an AG-only year is relabelled to its parent main.

Every cabin label -- family, adult, teen -- is TODAY's registry name, the
kindred#2332 pattern (owner ruling 2026-09-22, evening). The as-typed string
travels on `bunk_name_recorded`, but ONLY where it disagrees with the label.

From 2026, a family weekend with its own entry in `weekend_cabins` reads THAT
cabin instead of the year's one label (kindred#2801, mirroring the household
journey card's kindred#2775/#2789 rule). See `_family_season_housing`.

THE VIEWED YEAR (owner rulings 2026-09-24, kindred#2812). Every journey surface
shows the viewed year's enrollments, and they all build them the same way: on
the client, from the person's live attendees and live bunks (`useCamperHistory`).
The server adds only what that build cannot do itself -- a parent's family
weekends, which have no attendee row of the parent's to build from
(`current_year_parent_rows`), and the attributed adult cabins that label a live
adult-program row (`adult_cabins`, as `teen_cabins` labels a TLI/SCIT one).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable, Sequence
from typing import TYPE_CHECKING, Any, NamedTuple

from api.schemas.camper_journey import CamperJourneyCounts, CamperJourneyResponse, CamperJourneyRow
from api.schemas.lodging import (
    HouseholdJourneyResponse,
    HouseholdJourneyYear,
    PersonHousingResponse,
    PersonHousingWeekend,
)
from api.services.lodging_roster_service import LodgingRosterService
from api.services.person_housing_service import PersonHousingService
from api.utils.session_metrics import SUMMER_TEEN_TYPES
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository

logger = get_logger(__name__)

# CampMinder's age at or over which a viewer sees the family weekends their
# household's children attended (owner ruling 2026-09-22: raised from 18 to
# 21 -- teens 18-20 are still campers in summer and teen programs). The
# client's `ADULT_AGE` (`frontend/src/utils/age.ts`) is the same cutoff for
# how an age is DISPLAYED; a test holds the two equal.
ADULT_AGE = 21

FAMILY = "family"
ADULT = "adult"
AG = "ag"
QUEST = "quest"


class PersonJourneyFacts(NamedTuple):
    """What the journey needs from a person's year-scoped rows at the viewed year."""

    household_id: int | None
    summers: int
    # CampMinder's own age >= ADULT_AGE. Decides whether parent family-camp
    # rows join the journey.
    is_adult: bool


class JourneyFeed(NamedTuple):
    # Prior years only, newest first, chronological within a year.
    rows: list[CamperJourneyRow]
    # Distinct (year, session) weekends, the viewed year included.
    family_weekends: int
    adult_weekends: int
    # The viewed year's family weekends AS A PARENT (kindred#2812), for an
    # adult viewer: counted above, and the one current-year row the client's
    # live attendee build cannot make. Chronological.
    current_year_parent_rows: list[CamperJourneyRow]


class _CabinLabel(NamedTuple):
    cabin_name: str
    cabin_name_raw: str


def _str(record: Any, field: str) -> str:
    value = getattr(record, field, "")
    return "" if value is None else str(value)


def _int(record: Any, field: str) -> int:
    try:
        return int(getattr(record, field, 0) or 0)
    except TypeError, ValueError:
        return 0


def _session(row: Any) -> Any:
    expand = getattr(row, "expand", None) or {}
    return expand.get("session") if isinstance(expand, dict) else None


def _bunk(row: Any) -> Any:
    expand = getattr(row, "expand", None) or {}
    return expand.get("bunk") if isinstance(expand, dict) else None


def _session_type(session: Any) -> str:
    return _str(session, "session_type") if session is not None else ""


def _is_teen_program(session_type: str) -> bool:
    return session_type in SUMMER_TEEN_TYPES


def person_journey_facts(rows: Sequence[Any], view_year: int) -> PersonJourneyFacts:
    """What the journey needs from the person's year-scoped rows.

    `summers` is the most recent NON-ZERO `years_at_camp`: CampMinder fills it
    only in seasons someone is a camper, so an adult's current row reads 0
    while their last camper year still holds the count (103 of 105 grown-up
    campers). Like the weekend counts, it stops at `view_year` -- a later
    season never leaks back.

    No fallback to the newest row when every row postdates `view_year` (CR #5,
    kindred#2753): that leaked a LATER year's household and adulthood into an
    earlier view. There is no view row then, and that is the answer.
    """
    # Stable, like the client's `sort((a, b) => b.year - a.year)`.
    newest_first = sorted(rows, key=lambda r: _int(r, "year"), reverse=True)
    view = next((r for r in newest_first if _int(r, "year") <= view_year), None)
    summers = next(
        (
            _int(r, "years_at_camp")
            for r in newest_first
            if _int(r, "year") <= view_year and _int(r, "years_at_camp") > 0
        ),
        0,
    )
    household_id = _int(view, "household_id") if view is not None else 0
    age = float(getattr(view, "age", 0) or 0) if view is not None else 0.0
    return PersonJourneyFacts(
        household_id=household_id if household_id > 0 else None,
        summers=summers,
        is_adult=age >= ADULT_AGE,
    )


def _recorded_if_different(label: str, raw: str) -> str | None:
    """The as-typed string, but ONLY where it disagrees with the label shown."""
    return raw if raw and raw != label else None


def _cabins_by_weekend(weekends: Iterable[PersonHousingWeekend]) -> dict[tuple[int, int], _CabinLabel]:
    """Server-named cabins keyed (year, session) -- the attributed adult
    cabins, and the TLI/SCIT cabins the registry resolves (same row shape).
    Both sides trimmed, so outer whitespace never reads as a disagreement."""
    out: dict[tuple[int, int], _CabinLabel] = {}
    for w in weekends:
        cabin_name = w.cabin_name.strip()
        if cabin_name:
            out[(w.year, w.session_cm_id)] = _CabinLabel(cabin_name, w.cabin_name_raw.strip())
    return out


def _family_season_housing(y: HouseholdJourneyYear, session_cm_id: int) -> _CabinLabel | None:
    """One (year, weekend)'s cabin, or None when this weekend has none to show.

    From 2026 (kindred#2801, the household journey card's own rule --
    kindred#2775, shipped in #2789 -- off the same fields): a weekend with its
    own entry in `weekend_cabins` -- the CampMinder layer, published only when
    EVERY enrolled weekend that season has a live row -- is labelled from
    THAT entry, ahead of everything below.

    Otherwise (every year before 2026, and any 2026+ year the layer does not
    fully cover) today's one-cabin-for-the-year rule: a PLACED year's own
    `cabin_name`, shown on its pinned weekend (`housing_session_cm_id`,
    kindred#2461), or on EVERY family weekend that season when the year is not
    pinned at all -- CampMinder's one per-year value cannot say which weekend
    it describes (owner ruling 2026-09-22, late: "just show the same cabin for
    all... no one will care if historical data is wrong"). A year with no
    housing or a blank cabin shows nothing.
    """
    weekend_cabin = next((entry for entry in y.weekend_cabins if entry.session_cm_id == session_cm_id), None)
    if weekend_cabin is not None and weekend_cabin.cabin_name.strip():
        return _CabinLabel(weekend_cabin.cabin_name.strip(), weekend_cabin.cabin_name_raw.strip())
    cabin_name = y.cabin_name.strip()
    if y.housing != "placed" or not cabin_name:
        return None
    pin = y.housing_session_cm_id
    if pin is not None and pin != session_cm_id:
        return None
    return _CabinLabel(cabin_name, y.cabin_name_raw.strip())


def _labelled(housing: _CabinLabel | None) -> tuple[str | None, str | None]:
    if housing is None:
        return None, None
    return housing.cabin_name, _recorded_if_different(housing.cabin_name, housing.cabin_name_raw)


class _ParentFamilyWeekend(NamedTuple):
    key: tuple[int, int]
    year: int
    row: CamperJourneyRow


def _parent_family_weekends(
    years: Sequence[HouseholdJourneyYear], own_family: set[tuple[int, int]], view_year: int
) -> list[_ParentFamilyWeekend]:
    """Family camp AS A PARENT: every weekend a child in the household was
    ENROLLED on (the household journey's `sessions` come from enrolled
    children only), except one the adult attended themself. A
    paper-registration year carries no session and adds nothing. Known limit:
    household membership cannot tell a parent from an older sibling."""
    out: list[_ParentFamilyWeekend] = []
    for y in years:
        if y.year > view_year:
            continue
        for s in y.sessions:
            if s.session_cm_id <= 0:
                continue
            key = (y.year, s.session_cm_id)
            if key in own_family:
                continue
            bunk_name, recorded = _labelled(_family_season_housing(y, s.session_cm_id))
            out.append(
                _ParentFamilyWeekend(
                    key=key,
                    year=y.year,
                    row=CamperJourneyRow(
                        year=y.year,
                        session_name=s.name,
                        session_type=FAMILY,
                        bunk_name=bunk_name,
                        bunk_name_recorded=recorded,
                        start_date=s.start_date or None,
                    ),
                )
            )
    return out


def _by_year_then_chronological(row: CamperJourneyRow) -> tuple[int, int, str]:
    """Year descending, then CHRONOLOGICAL WITHIN THE YEAR -- across programs,
    not within each one (owner, 2026-08-18). A row with no start date sorts
    LAST in its year: an empty string would otherwise sort first and read as
    the first thing that happened. The client's `byYearThenChronological`,
    which still orders the merged current + prior years."""
    start = row.start_date or ""
    return (-row.year, 0 if start else 1, start)


async def build_journey_feed(
    repository: LodgingRepository,
    person_cm_id: int,
    view_year: int,
    *,
    family_years: Sequence[HouseholdJourneyYear] = (),
    adult_weekends: Sequence[PersonHousingWeekend] = (),
    teen_cabins: Sequence[PersonHousingWeekend] = (),
    viewer_is_adult: bool = False,
) -> JourneyFeed:
    """The journey's rows and weekend counts as of `view_year`.

    `family_years` is the household's family-camp journey; `adult_weekends`
    and `teen_cabins` are the person-housing read's two lists. Any of them
    may be empty, and every row they would label then shows no housing --
    never the day group or a raw program group in its place.
    """
    if person_cm_id <= 0:
        return JourneyFeed(rows=[], family_weekends=0, adult_weekends=0, current_year_parent_rows=[])

    family_housing = {y.year: y for y in family_years}
    adult_housing = _cabins_by_weekend(adult_weekends)
    teen_housing = _cabins_by_weekend(teen_cabins)

    # 1. Enrollments -- the journey's source of truth, read THROUGH the viewed
    # year so the counts include it; the rows stay prior-year.
    all_attendees = await repository.fetch_person_journey_attendees(person_cm_id, view_year)

    # (year, session) pairs -- CampMinder reuses session ids across years, so
    # a bare session id would count three Keshet weekends as one.
    def weekend_keys(session_type: str) -> set[tuple[int, int]]:
        keys: set[tuple[int, int]] = set()
        for a in all_attendees:
            session = _session(a)
            if _session_type(session) == session_type and _int(session, "cm_id") > 0:
                keys.add((_int(a, "year"), _int(session, "cm_id")))
        return keys

    own_family = weekend_keys(FAMILY)
    adult_count = len(weekend_keys(ADULT))
    parent_family = _parent_family_weekends(family_years, own_family, view_year) if viewer_is_adult else []
    family_count = len(own_family | {p.key for p in parent_family})
    parent_rows = [p.row for p in parent_family if p.year < view_year]
    # kindred#2812: counted in `family_count` all along, and never shown -- a
    # parent has no family-camp attendee row, so the client's current-year
    # build (live attendees) has nothing to make them from. A weekend the
    # person is enrolled on themself is already out (`own_family`): the client
    # builds that one.
    current_year_parent_rows = sorted(
        (p.row for p in parent_family if p.year == view_year), key=_by_year_then_chronological
    )

    attendees = [a for a in all_attendees if _int(a, "year") < view_year]
    if not attendees:
        return JourneyFeed(
            rows=sorted(parent_rows, key=_by_year_then_chronological),
            family_weekends=family_count,
            adult_weekends=adult_count,
            current_year_parent_rows=current_year_parent_rows,
        )

    # Collapse AG sub-tracks into their parent main: when both are enrolled
    # the same year, AG is not a separate attendance. An AG enrolled without
    # its parent main keeps its row. The ONLY same-year collapse. `cm_id` and
    # `parent_id` both default to 0 when absent, so a non-positive id never
    # identifies a real parent -- without the `> 0` checks, a cm_id-less
    # session would seed 0 and collapse an unrelated parentless AG row.
    enrolled_by_year: dict[int, set[int]] = {}
    for a in attendees:
        cm_id = _int(_session(a), "cm_id")
        if cm_id > 0:
            enrolled_by_year.setdefault(_int(a, "year"), set()).add(cm_id)

    def survives_collapse(a: Any) -> bool:
        session = _session(a)
        parent_id = _int(session, "parent_id")
        if _session_type(session) != AG or parent_id <= 0:
            return True
        return parent_id not in enrolled_by_year.get(_int(a, "year"), set())

    deduped = [a for a in attendees if survives_collapse(a)]

    # 2. Prior-year bunk assignments -- used ONLY to label a row, never to
    # gate one. A TLI/SCIT/Quest "bunk" is a program group or a trip name
    # (Q9): its own row never reads it (see the overrides below), and it must
    # not reach a summer row through the year-fallback either.
    assignments = await repository.fetch_person_journey_assignments(person_cm_id, view_year)
    assignments_by_year: dict[int, list[Any]] = {}
    for asn in assignments:
        asn_type = _session_type(_session(asn))
        if _is_teen_program(asn_type) or asn_type == QUEST:
            continue
        assignments_by_year.setdefault(_int(asn, "year"), []).append(asn)

    # Parent mains for any surviving AG rows -- one read, only when AG is
    # present. A non-positive parent id names no session (the sentinel above).
    ag_pairs = [
        (_int(a, "year"), _int(_session(a), "parent_id"))
        for a in deduped
        if _session_type(_session(a)) == AG and _int(_session(a), "parent_id") > 0
    ]
    parent_by_key: dict[tuple[int, int], Any] = {}
    if ag_pairs:
        for s in await repository.fetch_sessions_by_year_cm_id(ag_pairs):
            parent_by_key[(_int(s, "year"), _int(s, "cm_id"))] = s

    records = [
        _journey_row(
            a,
            assignments_by_year.get(_int(a, "year"), []),
            family_housing=family_housing,
            adult_housing=adult_housing,
            teen_housing=teen_housing,
            parent_by_key=parent_by_key,
        )
        for a in deduped
    ]
    return JourneyFeed(
        rows=sorted([*records, *parent_rows], key=_by_year_then_chronological),
        family_weekends=family_count,
        adult_weekends=adult_count,
        current_year_parent_rows=current_year_parent_rows,
    )


def _journey_row(
    att: Any,
    year_assignments: list[Any],
    *,
    family_housing: dict[int, HouseholdJourneyYear],
    adult_housing: dict[tuple[int, int], _CabinLabel],
    teen_housing: dict[tuple[int, int], _CabinLabel],
    parent_by_key: dict[tuple[int, int], Any],
) -> CamperJourneyRow:
    session = _session(att)
    year = _int(att, "year")
    session_type = _session_type(session)
    cm_id = _int(session, "cm_id") if session is not None else None

    # Bunk-label join precedence (spec section 7):
    # 1. the exact (year, session) match;
    match = next(
        (a for a in year_assignments if (_int(_session(a), "cm_id") if _session(a) is not None else None) == cm_id),
        None,
    )
    # 2. else the year-fallback, ONLY when the year has exactly one
    # assignment AND it sits on the same side of the family/non-family split
    # as the row -- otherwise a lone family-camp assignment could attach to an
    # unrelated summer row (the leak fb1a88d2 closed for current-year views);
    # 3. else no label.
    if match is None and len(year_assignments) == 1:
        candidate = year_assignments[0]
        if (_session_type(_session(candidate)) == FAMILY) == (session_type == FAMILY):
            match = candidate
    bunk = _bunk(match) if match is not None else None
    bunk_name: str | None = _str(bunk, "name") if bunk is not None else None
    recorded: str | None = None

    # kindred#2466: a family row shows the household's ACTUAL HOUSING -- the
    # day group matched above is discarded unconditionally, never relabelled.
    # From 2026, this weekend's own `weekend_cabins` entry leads (kindred#2801).
    if session_type == FAMILY:
        household_year = family_housing.get(year)
        family = _family_season_housing(household_year, cm_id or 0) if household_year is not None else None
        bunk_name, recorded = _labelled(family)

    # Adult programs: the cabin the server attributed to THIS weekend, or
    # nothing -- never a bunk, so the year-fallback cannot pin a lone summer
    # bunk onto an adult row.
    if session_type == ADULT:
        bunk_name, recorded = _labelled(adult_housing.get((year, cm_id or 0)))

    # Teen programs (Q9): CampMinder's TLI/SCIT bunk is usually a program
    # group, so the label is ONLY the registry-resolved cabin for THIS
    # (year, session), or nothing. Quest's "bunk" is a trip name: never a cabin.
    if _is_teen_program(session_type):
        bunk_name, recorded = _labelled(teen_housing.get((year, cm_id or 0)))
    if session_type == QUEST:
        bunk_name, recorded = None, None

    # AG is never shown as its own session: a surviving AG-only row takes its
    # parent main's name and dates, and reads as "main" either way. Its bunk
    # already came from the exact (year, AG-session) match above -- AG bunks
    # are filed under the AG session itself.
    parent = parent_by_key.get((year, _int(session, "parent_id"))) if session_type == AG else None
    display = parent if parent is not None else session
    name = _optional_str(display, "name")

    return CamperJourneyRow(
        year=year,
        session_name="Unknown" if name is None else name,
        session_type="main" if session_type == AG else session_type,
        bunk_name=bunk_name,
        bunk_name_recorded=recorded,
        start_date=_optional_str(display, "start_date"),
        end_date=_optional_str(display, "end_date"),
    )


def _optional_str(record: Any, field: str) -> str | None:
    """A field the client carried only when the record had it at all: absent
    stays None, and a present empty string stays "" -- exactly as before."""
    if record is None:
        return None
    value = getattr(record, field, None)
    return None if value is None else str(value)


HouseholdJourneyRead = Callable[[int], Awaitable[HouseholdJourneyResponse]]
PersonHousingRead = Callable[[int], Awaitable[PersonHousingResponse]]


class CamperJourneyService:
    """`GET /api/campers/{id}/journey`: the person's facts, the two housing
    reads, and the feed, in one call.

    The household journey and the person-housing read are the SAME services
    their own endpoints serve (`LodgingRosterService.build_household_journey`,
    `PersonHousingService.build_person_housing`), so a cabin is named here
    exactly as it is on the weekend board's household card.
    """

    def __init__(
        self,
        repository: LodgingRepository,
        *,
        household_journey: HouseholdJourneyRead | None = None,
        person_housing: PersonHousingRead | None = None,
    ) -> None:
        self.repository = repository
        if household_journey is None:
            household_journey = LodgingRosterService(repository).build_household_journey
        if person_housing is None:
            person_housing = PersonHousingService(repository).build_person_housing
        self._household_journey = household_journey
        self._person_housing = person_housing

    async def build_camper_journey(self, person_cm_id: int, year: int) -> CamperJourneyResponse:
        if person_cm_id <= 0:
            return CamperJourneyResponse()
        facts = person_journey_facts(await self.repository.fetch_person_records(person_cm_id), year)
        household, housing = await asyncio.gather(
            self._degrading(
                "household journey",
                self._household_journey(facts.household_id) if facts.household_id is not None else None,
                HouseholdJourneyResponse(),
            ),
            self._degrading("person housing", self._person_housing(person_cm_id), PersonHousingResponse()),
        )
        feed = await build_journey_feed(
            self.repository,
            person_cm_id,
            year,
            family_years=household.years,
            adult_weekends=housing.weekends,
            teen_cabins=housing.teen_cabins,
            viewer_is_adult=facts.is_adult,
        )
        return CamperJourneyResponse(
            rows=feed.rows,
            current_year_parent_rows=feed.current_year_parent_rows,
            counts=CamperJourneyCounts(
                summers=facts.summers,
                family_weekends=feed.family_weekends,
                adult_weekends=feed.adult_weekends,
            ),
            teen_cabins=housing.teen_cabins,
            adult_cabins=housing.weekends,
        )

    @staticmethod
    async def _degrading[T](what: str, read: Awaitable[T] | None, empty: T) -> T:
        """A housing read that fails leaves its rows UNLABELLED rather than
        failing the journey -- the degradation the client merge made
        deliberately (an errored household or housing read still let the feed
        run). The persons and enrollment reads are not wrapped: without them
        there is no journey to degrade to."""
        if read is None:
            return empty
        try:
            return await read
        except Exception:
            logger.warning("Camper journey: the %s read failed; its rows show no housing", what, exc_info=True)
            return empty
