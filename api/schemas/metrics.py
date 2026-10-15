"""
Pydantic schemas for metrics API endpoints.

Defines response models for retention, registration, and trends metrics.
"""

from typing import Literal

from pydantic import BaseModel, Field


class GenderBreakdown(BaseModel):
    """Breakdown of metrics by gender."""

    gender: str = Field(description="Gender (M, F, or other)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")
    no_enrollment: int = Field(default=0, description="Waitlisted with no other enrollment")
    has_enrollment: int = Field(default=0, description="Waitlisted but enrolled in other session")
    was_enrolled: int = Field(default=0, description="Cancelled after being enrolled")
    was_waitlisted: int = Field(default=0, description="Cancelled after being waitlisted")
    was_applied: int = Field(default=0, description="Cancelled after applying")
    other_prior_status: int = Field(default=0, description="Cancelled from other prior status")


class GradeBreakdown(BaseModel):
    """Breakdown of metrics by grade."""

    grade: int | None = Field(description="Grade level (None if unknown)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")
    no_enrollment: int = Field(default=0, description="Waitlisted with no other enrollment")
    has_enrollment: int = Field(default=0, description="Waitlisted but enrolled in other session")
    was_enrolled: int = Field(default=0, description="Cancelled after being enrolled")
    was_waitlisted: int = Field(default=0, description="Cancelled after being waitlisted")
    was_applied: int = Field(default=0, description="Cancelled after applying")
    other_prior_status: int = Field(default=0, description="Cancelled from other prior status")


class SessionBreakdown(BaseModel):
    """Breakdown of metrics by session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    session_type: str | None = Field(
        None, description="Session type (main, embedded, quest, scit, tli...); teen programs match by type"
    )
    count: int = Field(description="Number of campers")
    capacity: int | None = Field(None, description="Session capacity (if available)")
    utilization: float | None = Field(None, description="Capacity utilization percentage")


class YearsAtCampBreakdown(BaseModel):
    """Breakdown of metrics by years at camp."""

    years: int = Field(description="Number of years at camp")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class NewVsReturning(BaseModel):
    """New vs returning camper breakdown."""

    new_count: int = Field(description="Number of new campers (years_at_camp == 1)")
    returning_count: int = Field(description="Number of returning campers")
    new_percentage: float = Field(description="Percentage of new campers")
    returning_percentage: float = Field(description="Percentage of returning campers")


class SchoolBreakdown(BaseModel):
    """Breakdown of metrics by school (raw value from CampMinder)."""

    school: str = Field(description="School name (raw, may need normalization)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class CityBreakdown(BaseModel):
    """Breakdown of metrics by city."""

    city: str = Field(description="City name")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class SynagogueBreakdown(BaseModel):
    """Breakdown of metrics by synagogue."""

    synagogue: str = Field(description="Synagogue name")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class GenderByGradeBreakdown(BaseModel):
    """Gender breakdown for a specific grade.

    Shows male/female counts per grade for stacked bar chart visualization.
    Note: Only M/F tracked since CampMinder sex field only has these values.
    """

    grade: int | None = Field(description="Grade level (None if unknown)")
    male_count: int = Field(description="Number of male campers")
    female_count: int = Field(description="Number of female campers")
    total: int = Field(description="Total campers in this grade")


class SessionInLengthCategory(BaseModel):
    """A session within a length category.

    Used for stacked bar chart showing session breakdown per length category.
    """

    session_name: str = Field(description="Session name")
    session_cm_id: int = Field(description="CampMinder session ID")
    count: int = Field(description="Number of campers in this session")


class SessionLengthBySessionBreakdown(BaseModel):
    """Session breakdown for a specific length category.

    Shows which sessions fall into each length category with camper counts.
    """

    length_category: str = Field(description="Length category (1-week, 2-week, etc.)")
    sessions: list[SessionInLengthCategory] = Field(description="Sessions in this category")
    total: int = Field(description="Total campers in this length category")


class GenderBySessionLengthBreakdown(BaseModel):
    """Gender breakdown for a specific session length category.

    Shows male/female counts per session length for stacked bar chart visualization.
    Note: Only M/F tracked since CampMinder sex field only has these values.
    """

    length_category: str = Field(description="Length category (1-week, 2-week, etc.)")
    male_count: int = Field(description="Number of male campers")
    female_count: int = Field(description="Number of female campers")
    total: int = Field(description="Total campers in this length category")


class SummerYearsBreakdown(BaseModel):
    """Breakdown by Summers at Camp: CampMinder's Years At Camp for the season.

    Reads persons.years_at_camp (epic #3207 decision 36). Attendance history
    starts in 2017, so it undercounts anyone who came before.
    """

    summer_years: int = Field(description="CampMinder Years At Camp (0 when none is recorded)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class FirstSummerYearBreakdown(BaseModel):
    """Breakdown by first summer year (cohort analysis).

    Shows how many current campers started in each year.
    """

    first_summer_year: int = Field(
        description="Year camper first attended summer camp, from history; 2017 means 2017 or earlier"
    )
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


# ============================================================================
# Retention Metrics
# ============================================================================


class RetentionByGender(BaseModel):
    """Retention metrics by gender."""

    gender: str = Field(description="Gender (M, F, or other)")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByGrade(BaseModel):
    """Retention metrics by grade (base year grade)."""

    grade: int | None = Field(description="Grade level in base year")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionBySession(BaseModel):
    """Retention metrics by session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByYearsAtCamp(BaseModel):
    """Retention metrics by years at camp (base year value)."""

    years: int = Field(description="Years at camp in base year")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionBySchool(BaseModel):
    """Retention metrics by school."""

    school: str = Field(description="School name")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByCity(BaseModel):
    """Retention metrics by city."""

    city: str = Field(description="City name")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionBySynagogue(BaseModel):
    """Retention metrics by synagogue."""

    synagogue: str = Field(description="Synagogue name")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionBySessionBunk(BaseModel):
    """Retention metrics by session+bunk combination."""

    session: str = Field(description="Session name")
    bunk: str = Field(description="Bunk name")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionBySummerYears(BaseModel):
    """Retention metrics by Summers at Camp: CampMinder's Years At Camp in the base season.

    Reads the base year's persons.years_at_camp (epic #3207 decision 36), the
    tenure a camper had in the summer they did or didn't return from.
    """

    summer_years: int = Field(description="CampMinder Years At Camp in the base season (0 when none is recorded)")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByFirstSummerYear(BaseModel):
    """Retention metrics by first summer year (cohort analysis).

    Shows retention by when campers first joined summer camp,
    enabling cohort-based retention analysis.
    """

    first_summer_year: int = Field(
        description="Year camper first attended summer camp, from history; 2017 means 2017 or earlier"
    )
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByPriorSession(BaseModel):
    """Retention metrics by prior year session.

    Shows retention rate broken down by what session campers
    were enrolled in during the prior year.
    """

    prior_session: str = Field(description="Session name from prior year")
    start_date: str | None = Field(default=None, description="Session start date for sorting")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year (any session)")
    retention_rate: float = Field(description="Retention rate (0-1)")


class SessionFlowItem(BaseModel):
    """A single flow link for the session flow Sankey diagram.

    Represents how many campers moved from a base year session
    to a compare year session (or did not return).
    """

    source: str = Field(description="Base year session name")
    target: str = Field(description="Compare year session name or 'Did Not Return'")
    value: int = Field(description="Number of campers in this flow")
    source_cm_id: int = Field(description="CampMinder session ID for the source (base year)")
    target_cm_id: int | None = Field(
        default=None, description="CampMinder session ID for the target, None for 'Did Not Return'"
    )


class RetentionMetricsResponse(BaseModel):
    """Response model for retention metrics endpoint."""

    base_year: int = Field(description="Base year for comparison")
    compare_year: int = Field(description="Comparison year")
    base_year_total: int = Field(description="Total enrolled in base year")
    returned_count: int = Field(description="Number who returned from base year")
    overall_retention_rate: float = Field(description="Overall retention rate (0-1)")

    by_gender: list[RetentionByGender] = Field(description="Retention by gender")
    by_grade: list[RetentionByGrade] = Field(description="Retention by grade")
    by_session: list[RetentionBySession] = Field(description="Retention by base year session")
    by_years_at_camp: list[RetentionByYearsAtCamp] = Field(description="Retention by years at camp")
    by_school: list[RetentionBySchool] = Field(default_factory=list, description="Retention by school")
    by_city: list[RetentionByCity] = Field(default_factory=list, description="Retention by city")
    by_synagogue: list[RetentionBySynagogue] = Field(default_factory=list, description="Retention by synagogue")
    by_session_bunk: list[RetentionBySessionBunk] = Field(
        default_factory=list, description="Retention by session+bunk combination"
    )
    # New breakdowns for retention tab redesign (calculated from attendees history)
    by_summer_years: list[RetentionBySummerYears] = Field(
        default_factory=list, description="Retention by Summers at Camp (CampMinder Years At Camp, base season)"
    )
    by_first_summer_year: list[RetentionByFirstSummerYear] = Field(
        default_factory=list, description="Retention by first summer year (cohort analysis)"
    )
    by_prior_session: list[RetentionByPriorSession] = Field(
        default_factory=list, description="Retention by prior year session"
    )
    session_flow: list[SessionFlowItem] = Field(
        default_factory=list, description="Session-to-session flow data for Sankey diagram"
    )
    aged_out_count: int = Field(0, description="Base year campers excluded (aged out of all eligible sessions)")


# ============================================================================
# Registration Metrics
# ============================================================================


class RegistrationMetricsResponse(BaseModel):
    """Response model for registration metrics endpoint."""

    year: int = Field(description="Year for metrics")
    total_enrolled: int = Field(description="Total enrolled campers")
    total_waitlisted: int | None = Field(
        description="Total waitlisted campers. None on a same-point read: a past waitlist cannot be rebuilt"
    )
    total_cancelled: int = Field(description="Total cancelled registrations")

    by_gender: list[GenderBreakdown] = Field(description="Enrollment by gender")
    by_grade: list[GradeBreakdown] = Field(description="Enrollment by grade")
    by_session: list[SessionBreakdown] = Field(description="Enrollment by session")
    by_years_at_camp: list[YearsAtCampBreakdown] = Field(description="Enrollment by years at camp")
    new_vs_returning: NewVsReturning = Field(description="New vs returning breakdown")
    # New breakdowns (computed from persons.school/address_city/synagogue)
    by_school: list[SchoolBreakdown] = Field(default_factory=list, description="Enrollment by school")
    by_city: list[CityBreakdown] = Field(default_factory=list, description="Enrollment by city")
    by_synagogue: list[SynagogueBreakdown] = Field(default_factory=list, description="Enrollment by synagogue")
    # New breakdowns for registration tab redesign
    by_gender_grade: list[GenderByGradeBreakdown] = Field(
        default_factory=list, description="Gender breakdown by grade (for stacked bar chart)"
    )
    by_session_length_by_session: list[SessionLengthBySessionBreakdown] = Field(
        default_factory=list, description="Session breakdown by length category (for stacked bar chart)"
    )
    by_gender_by_session_length: list[GenderBySessionLengthBreakdown] = Field(
        default_factory=list, description="Gender breakdown by session length category (for stacked bar chart)"
    )
    by_summer_years: list[SummerYearsBreakdown] = Field(
        default_factory=list, description="Enrollment by Summers at Camp (CampMinder Years At Camp)"
    )
    average_summers_at_camp: float | None = Field(
        default=None,
        description="Mean CampMinder Years At Camp of the campers in by_summer_years; null when there are none",
    )
    by_first_summer_year: list[FirstSummerYearBreakdown] = Field(
        default_factory=list, description="Enrollment by first summer year (cohort analysis)"
    )
    # Decision 7: a comparison year asked for with same_point_of
    prior_basis: Literal["same_point", "final"] | None = Field(
        default=None,
        description=(
            "Set when same_point_of was asked: 'same_point' when this year was read at the registration day "
            "that season has reached (registered by then and not cancelled by then), 'final' when it was read "
            "as it stands now (that season is over, or a season has no registration anchor)"
        ),
    )
    day_offset: int | None = Field(
        default=None,
        description="Same-point reads: the registration day (days from its anchor) the same_point_of season is on",
    )
    prior_day_offset: int | None = Field(
        default=None,
        description=(
            "Same-point reads: the registration day this year was read at. One more than day_offset on a "
            "priority, early or open date, where the prior year is read through the next day (decision 45)"
        ),
    )
    as_of_date: str | None = Field(
        default=None,
        description=(
            "Same-point reads: the last day (YYYY-MM-DD) this year was read through. On a phase date it is the "
            "day after the matching day (decision 45)"
        ),
    )


# ============================================================================
# Historical Trends Metrics
# ============================================================================


class YearMetrics(BaseModel):
    """Summary metrics for a single year in historical trends."""

    year: int = Field(description="Year")
    total_enrolled: int = Field(description="Total enrolled campers")
    by_gender: list[GenderBreakdown] = Field(description="Enrollment by gender")
    new_vs_returning: NewVsReturning = Field(description="New vs returning breakdown")
    total_cancelled: int = Field(
        default=0, description="Campers whose final status is cancelled this year (same count as Overview)"
    )
    cancellation_rate: float = Field(default=0.0, description="Cancelled / (enrolled + cancelled)")
    has_cancellation_data: bool = Field(
        default=True,
        description=(
            "Whether this year's cancellations were measured. total_cancelled counts campers "
            "whose final status is cancelled (decision 10), which every season has, so this is "
            "false only when the fetch failed -- consumers render 'no data', never a fabricated 0/0.0%."
        ),
    )


class HistoricalTrendsResponse(BaseModel):
    """Response model for historical trends endpoint."""

    years: list[YearMetrics] = Field(description="Metrics for each year")


# ============================================================================
# Enrollment By Year (3-Year Comparison)
# ============================================================================


class GenderEnrollment(BaseModel):
    """Gender enrollment count for a single year."""

    gender: str = Field(description="Gender (M, F, or other)")
    count: int = Field(description="Number enrolled")


class GradeEnrollment(BaseModel):
    """Grade enrollment count for a single year."""

    grade: int | None = Field(description="Grade level")
    count: int = Field(description="Number enrolled")


class SummerYearsEnrollment(BaseModel):
    """Summer years enrollment count for a single year."""

    summer_years: int = Field(description="CampMinder Years At Camp that year (0 when none is recorded)")
    count: int = Field(description="Number of campers")


class FirstSummerYearEnrollment(BaseModel):
    """First summer year enrollment count for a single year."""

    first_summer_year: int = Field(description="First summer year; 2017 means 2017 or earlier")
    count: int = Field(description="Number of campers")


class CityEnrollment(BaseModel):
    """City enrollment count for a single year."""

    city: str = Field(description="City name")
    count: int = Field(description="Number of campers")


class SchoolEnrollment(BaseModel):
    """School enrollment count for a single year."""

    school: str = Field(description="School name")
    count: int = Field(description="Number of campers")


class SynagogueEnrollment(BaseModel):
    """Synagogue enrollment count for a single year."""

    synagogue: str = Field(description="Synagogue name")
    count: int = Field(description="Number of campers")


class YearEnrollment(BaseModel):
    """Enrollment breakdown for a single year."""

    year: int = Field(description="Year")
    total: int = Field(description="Total enrolled")
    by_gender: list[GenderEnrollment] = Field(description="Enrollment by gender")
    by_grade: list[GradeEnrollment] = Field(description="Enrollment by grade")
    by_summer_years: list[SummerYearsEnrollment] = Field(
        default_factory=list, description="Enrollment by summers at camp"
    )
    by_first_summer_year: list[FirstSummerYearEnrollment] = Field(
        default_factory=list, description="Enrollment by first summer year"
    )
    by_city: list[CityEnrollment] = Field(default_factory=list, description="Enrollment by city")
    by_school: list[SchoolEnrollment] = Field(default_factory=list, description="Enrollment by school")
    by_synagogue: list[SynagogueEnrollment] = Field(default_factory=list, description="Enrollment by synagogue")


# ============================================================================
# Retention Trends (3-Year View)
# ============================================================================


class RetentionTrendYear(BaseModel):
    """Retention metrics for a single year transition."""

    from_year: int = Field(description="Base year")
    to_year: int = Field(description="Compare year")
    retention_rate: float = Field(description="Overall retention rate (0-1)")
    base_count: int = Field(description="Total campers in base year")
    returned_count: int = Field(description="Campers who returned")
    by_gender: list[RetentionByGender] = Field(default_factory=list, description="Retention by gender")
    by_grade: list[RetentionByGrade] = Field(default_factory=list, description="Retention by grade")
    aged_out_count: int = Field(0, description="Base year campers excluded (aged out of all eligible sessions)")


class RetentionTrendsResponse(BaseModel):
    """Response model for retention trends endpoint (3-year view)."""

    years: list[RetentionTrendYear] = Field(description="Retention data for each year transition")
    # Enrollment counts per year for 3-year comparison charts
    enrollment_by_year: list[YearEnrollment] = Field(
        default_factory=list, description="Enrollment counts per year for 3-year comparison"
    )


# ============================================================================
# Waitlist Analysis
# ============================================================================


class WaitlistEnrolledSessionCount(BaseModel):
    """Count of waitlisted persons enrolled in a specific session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    count: int = Field(description="Number of waitlisted persons enrolled in this session")


class WaitlistSessionBreakdown(BaseModel):
    """Per-session waitlist breakdown."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    waitlisted: int = Field(description="Currently waitlisted count")
    no_enrollment: int = Field(default=0, description="Waitlisted with no other enrollment")
    has_enrollment: int = Field(default=0, description="Waitlisted but enrolled in other session")
    accepted: int = Field(0, description="Previously waitlisted, now enrolled")
    declined: int = Field(0, description="Previously waitlisted, cancelled/withdrawn/dismissed")
    enrolled_in: list[WaitlistEnrolledSessionCount] = Field(
        default_factory=list, description="Per-session enrollment breakdown for has_enrollment persons"
    )


class WaitlistMetricsResponse(BaseModel):
    """Response model for waitlist analysis endpoint."""

    year: int = Field(description="Year for metrics")
    total_waitlisted: int = Field(description="Total currently waitlisted (unique persons)")
    waitlisted_no_enrollment: int = Field(description="Waitlisted with no enrolled summer sessions (UC1)")
    waitlisted_has_enrollment: int = Field(description="Waitlisted but enrolled in other sessions (UC2)")
    total_accepted: int = Field(description="Previously waitlisted, now enrolled (UC3)")
    total_declined: int = Field(description="Previously waitlisted, declined placement (UC4)")
    avg_days_to_acceptance: float | None = Field(
        default=None, description="Avg days from waitlist application to acceptance"
    )
    median_days_to_acceptance: float | None = Field(
        default=None, description="Median days from waitlist application to acceptance"
    )
    avg_days_to_decline: float | None = Field(default=None, description="Avg days from waitlist application to decline")
    median_days_to_decline: float | None = Field(
        default=None, description="Median days from waitlist application to decline"
    )
    by_session: list[WaitlistSessionBreakdown] = Field(
        default_factory=list, description="Per-session waitlist breakdown"
    )
    by_grade: list[GradeBreakdown] = Field(default_factory=list, description="Waitlisted by grade")
    by_gender: list[GenderBreakdown] = Field(default_factory=list, description="Waitlisted by gender")


# ============================================================================
# Cancellation Analysis
# ============================================================================


class TimeBucket(BaseModel):
    """A time distribution bucket."""

    label: str = Field(description="Bucket label (e.g. '< 30 days')")
    count: int = Field(description="Number of records in this bucket")
    percentage: float = Field(description="Percentage of total")


class RegistrationMonthBreakdown(BaseModel):
    """Breakdown by registration month."""

    month: str = Field(description="Month label (e.g. 'Nov 2025')")
    count: int = Field(description="Number of cancellations from this registration month")
    percentage: float = Field(description="Percentage of total")


class CancellationSessionBreakdown(BaseModel):
    """Per-session cancellation breakdown."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    total_cancelled: int = Field(description="Total cancelled in this session")
    was_enrolled: int = Field(default=0, description="Cancelled after being enrolled")
    was_waitlisted: int = Field(default=0, description="Cancelled after being waitlisted")
    was_applied: int = Field(default=0, description="Cancelled after applying")
    other_prior_status: int = Field(
        default=0, description="Cancelled from other prior status (inquiry, incomplete, etc.)"
    )
    has_other_sessions: int = Field(default=0, description="Cancelled but enrolled in other session")
    no_other_sessions: int = Field(default=0, description="Cancelled with no remaining enrollment")
    session_swap_count: int = Field(default=0, description="Session swaps (cancelled and enrolled in another)")


class CancellationMetricsResponse(BaseModel):
    """Response model for cancellation analysis endpoint."""

    year: int = Field(description="Year for metrics")
    total_cancelled: int = Field(description="Total cancelled (unique persons)")
    was_enrolled: int = Field(description="Cancelled after being enrolled")
    was_waitlisted: int = Field(description="Cancelled after being waitlisted")
    was_applied: int = Field(default=0, description="Cancelled after applying")
    other_prior_status: int = Field(
        default=0, description="Cancelled from other prior status (inquiry, incomplete, etc.)"
    )
    has_other_sessions: int = Field(description="Cancelled but enrolled in other session")
    no_other_sessions: int = Field(description="Cancelled with no remaining enrollment")
    total_re_enrolled: int = Field(default=0, description="Cancelled then later re-enrolled (recovery)")
    session_swap_count: int = Field(default=0, description="Cancellations that are session swaps")
    true_departure_count: int = Field(default=0, description="True departures (not session swaps)")
    avg_days_to_cancellation: float | None = Field(
        default=None, description="Avg days between registration and cancellation (non-swaps)"
    )
    median_days_to_cancellation: float | None = Field(
        default=None, description="Median days between registration and cancellation (non-swaps)"
    )
    time_to_cancellation_buckets: list[TimeBucket] = Field(
        default_factory=list, description="Time-to-cancellation distribution"
    )
    by_registration_month: list[RegistrationMonthBreakdown] = Field(
        default_factory=list, description="Cancellations grouped by registration month"
    )
    by_session: list[CancellationSessionBreakdown] = Field(
        default_factory=list, description="Per-session cancellation breakdown"
    )
    by_grade: list[GradeBreakdown] = Field(default_factory=list, description="Cancellations by grade")
    by_gender: list[GenderBreakdown] = Field(default_factory=list, description="Cancellations by gender")


# ============================================================================
# Drilldown (Chart Click-Through)
# ============================================================================


class DrilldownSession(BaseModel):
    """Session info for a deduped drilldown attendee."""

    session_name: str = Field(description="Session name")
    session_cm_id: int = Field(description="Session CampMinder ID")


class DrilldownAttendee(BaseModel):
    """Attendee record for drill-down display.

    Contains person and enrollment info for displaying in a modal when
    clicking a chart segment.
    """

    person_id: int = Field(description="Person CampMinder ID")
    first_name: str = Field(description="First name")
    last_name: str = Field(description="Last name")
    preferred_name: str | None = Field(None, description="Preferred name if set")
    grade: int | None = Field(None, description="Grade level")
    gender: str | None = Field(None, description="Gender (M, F, or other)")
    age: float | None = Field(None, description="Age in years")
    school: str | None = Field(None, description="School name")
    city: str | None = Field(None, description="City (parsed from address)")
    state: str | None = Field(None, description="State abbreviation (parsed from address)")
    years_at_camp: int | None = Field(None, description="Years at camp")
    enrollment_date: str | None = Field(None, description="Enrollment date for waitlist ordering")
    effective_date: str | None = Field(None, description="Original registration date (EffectiveDate from CampMinder)")
    session_name: str = Field(description="Session name")
    session_cm_id: int = Field(description="Session CampMinder ID")
    status: str = Field(description="Enrollment status")
    is_returning: bool = Field(False, description="Whether camper is returning (years_at_camp > 1)")
    sessions: list[DrilldownSession] = Field(
        default_factory=list, description="All sessions for this person (populated for person-level breakdowns)"
    )
    enrolled_sessions: list[DrilldownSession] = Field(
        default_factory=list, description="Enrolled sessions (for waitlist breakdowns)"
    )
