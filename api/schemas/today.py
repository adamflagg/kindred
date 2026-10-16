"""Analytics Today (#3207 PR 8): Session fill and Recent sign-ups."""

from typing import Literal

from pydantic import BaseModel, Field


class TodaySessionPart(BaseModel):
    """One cabin group of a session (Girls, Boys, AG), or the whole of a quest or teen program ("")."""

    label: Literal["Girls", "Boys", "AG", ""] = Field(description="The cabin group; empty for a one-part row")
    enrolled: int = Field(description="Enrolled camper-sessions")
    waitlisted: int = Field(description="Waitlisted camper-sessions")
    beds: int | None = Field(description="Bunk-plan beds (or the places set in Manage); None when none are set")
    prior: int | None = Field(description="Last year's figure for this group; None when the session has no match")


class TodaySessionRow(BaseModel):
    """A session this year, with its own match last year (ruling #15)."""

    session_cm_id: int = Field(description="Session CampMinder ID; 0 for a teen program row (SCIT, TLI)")
    session_name: str
    session_type: str
    enrolled: int = Field(description="Enrolled camper-sessions, all-gender cabins included")
    waitlisted: int
    beds: int | None = Field(description="Bunk-plan beds or Manage's places; None when none are set")
    goal: int | None = Field(description="The budget config's participant goal; None when not set yet")
    prior: int | None = Field(
        description="Last year's enrolled camper-sessions in the matched session; None when nothing matches"
    )
    parts: list[TodaySessionPart]


class TodaySessionsResponse(BaseModel):
    year: int
    prior_year: int
    rows: list[TodaySessionRow] = Field(description="This year's sessions in session order (ruling #14)")
    limited_threshold: int = Field(description="The Availability page's 'limited' threshold, in percent")
    prior_basis: Literal["same_point", "final"] = Field(
        description="same_point: last year at the same registration day; final: last year's final"
    )
    day_offset: int | None = Field(None, description="This season's registration day (0 = the priority date)")
    prior_day_offset: int | None = Field(None, description="The registration day last year was read at")
    as_of_date: str | None = Field(None, description="The day last year was read at (YYYY-MM-DD)")


class RecentSignupLine(BaseModel):
    """One camper on one Enrolled-on day (decision 40)."""

    person_id: int = Field(description="Person CampMinder ID")
    first_name: str
    last_name: str
    preferred_name: str | None = None
    day: str = Field(description="Enrolled on, the camp-time day (YYYY-MM-DD)")
    sessions: list[str] = Field(description="The sessions enrolled in that day, in session order")
    is_new: bool = Field(description="New to camp (CampMinder's Years At Camp is 1)")
    is_second: bool = Field(description="Already held a summer session this season from an earlier day")


class RecentSignupsResponse(BaseModel):
    year: int
    since: str = Field(description="The window's first day (YYYY-MM-DD): today and the 6 days before it")
    today: str = Field(description="The camp-time day the window ends on (YYYY-MM-DD)")
    lines: list[RecentSignupLine] = Field(description="At most 6, newest first")
    enrollments: int = Field(description="Enrollments in scope whose Enrolled on day is in the window")
