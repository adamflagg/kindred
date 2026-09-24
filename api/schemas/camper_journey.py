"""The camper journey's one server read (kindred#2776).

`GET /api/campers/{person_cm_id}/journey?year=` answers what `useCamperJourney`
used to assemble on the client from four reads: the prior-year rows, the
header counts, and the TLI/SCIT cabins a current-year row looks itself up by.
Presentation -- row order across the current year, the compact grid, the
subtitles -- stays on the client.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from api.schemas.lodging import PersonHousingWeekend


class CamperJourneyRow(BaseModel):
    """One prior-year enrollment, labelled with its housing when known.

    The client's `HistoricalRecord`, field for field. Every optional field is
    `None` when the client used to leave it off the record, and never "" in
    its place -- an empty string is a real value that the client keeps, the
    same way it kept one before (an unnamed bunk, a session with no dates).
    """

    year: int = 0
    session_name: str = ""
    # "main" for an AG-only year relabelled to its parent main -- AG is never
    # shown as its own session.
    session_type: str = ""
    # Today's registry name for a family, adult or TLI/SCIT cabin
    # (kindred#2332); the assigned bunk for a summer session; None when
    # nothing is known. Never a family session's CampMinder day group
    # (kindred#2466), never a Quest trip name, never a teen program group.
    bunk_name: str | None = None
    # The as-typed string, ONLY where it disagrees with `bunk_name`. The
    # client renders it as a hover tooltip, never inline.
    bunk_name_recorded: str | None = None
    # The raw PocketBase strings of the session the row is labelled with.
    start_date: str | None = None
    end_date: str | None = None


class CamperJourneyCounts(BaseModel):
    """The journey header's counts, the same on every journey surface.

    `summers` is CampMinder's `years_at_camp` -- the most recent NON-ZERO value
    at or before the viewed year, because CampMinder zeroes it for adults.
    The weekend counts are distinct (year, session) enrollments through the
    viewed year: CampMinder reuses session ids across years.
    """

    summers: int = 0
    family_weekends: int = 0
    adult_weekends: int = 0


class CamperJourneyResponse(BaseModel):
    """A person's journey as of one viewed year.

    `rows` are the years BEFORE it, newest year first and chronological
    within a year. The viewed year itself is built on the client, from live
    attendees and live bunks, by every journey surface alike (owner rulings
    2026-09-24, kindred#2812); the three fields after `counts` are what that
    build needs from here.
    """

    rows: list[CamperJourneyRow] = Field(default_factory=list)
    counts: CamperJourneyCounts = Field(default_factory=CamperJourneyCounts)
    # The viewed year's family weekends the person attended AS A PARENT, for
    # a 21+ person: every weekend a child in the household was enrolled on
    # that they were not enrolled on themself. Labelled like a prior year's
    # parent row, chronological. Counted in `family_weekends`, and the one
    # current-year row the client cannot build -- a parent has no family-camp
    # attendee row of their own (kindred#2812).
    current_year_parent_rows: list[CamperJourneyRow] = Field(default_factory=list)
    # The person-housing read's two lists, passed through unchanged, current
    # year included: the client labels a live current-year TLI/SCIT row from
    # `teen_cabins` (owner ruling 2026-09-22 late, Q9) and a live adult-program
    # row from `adult_cabins` (kindred#2812) -- never from the raw CampMinder
    # bunk, exactly as the prior-year rows above.
    teen_cabins: list[PersonHousingWeekend] = Field(default_factory=list)
    adult_cabins: list[PersonHousingWeekend] = Field(default_factory=list)
