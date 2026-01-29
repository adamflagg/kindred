"""
Pydantic schemas for metrics API endpoints.

Defines response models for retention, registration, and comparison metrics.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class GenderBreakdown(BaseModel):
    """Breakdown of metrics by gender."""

    gender: str = Field(description="Gender (M, F, or other)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class GradeBreakdown(BaseModel):
    """Breakdown of metrics by grade."""

    grade: int | None = Field(description="Grade level (None if unknown)")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class SessionBreakdown(BaseModel):
    """Breakdown of metrics by session."""

    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session name")
    count: int = Field(description="Number of campers")
    capacity: int | None = Field(None, description="Session capacity (if available)")
    utilization: float | None = Field(None, description="Capacity utilization percentage")


class YearsAtCampBreakdown(BaseModel):
    """Breakdown of metrics by years at camp."""

    years: int = Field(description="Number of years at camp")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class SessionLengthBreakdown(BaseModel):
    """Breakdown of metrics by session length category."""

    length_category: str = Field(description="Session length (1-week, 2-week, 3-week)")
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


class FirstYearBreakdown(BaseModel):
    """Breakdown of metrics by first year attended."""

    first_year: int = Field(description="Year camper first attended camp")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class SessionBunkBreakdown(BaseModel):
    """Breakdown of metrics by session+bunk combination."""

    session: str = Field(description="Session name")
    bunk: str = Field(description="Bunk name")
    count: int = Field(description="Number of campers")


class GenderByGradeBreakdown(BaseModel):
    """Gender breakdown for a specific grade.

    Shows male/female/other counts per grade for stacked bar chart visualization.
    """

    grade: int | None = Field(description="Grade level (None if unknown)")
    male_count: int = Field(description="Number of male campers")
    female_count: int = Field(description="Number of female campers")
    other_count: int = Field(description="Number of other/unknown gender campers")
    total: int = Field(description="Total campers in this grade")


class SummerYearsBreakdown(BaseModel):
    """Breakdown by actual summer enrollment years.

    Calculated from attendees table enrollment history, not the potentially
    incorrect years_at_camp field in persons.
    """

    summer_years: int = Field(description="Number of summer years enrolled")
    count: int = Field(description="Number of campers")
    percentage: float = Field(description="Percentage of total")


class FirstSummerYearBreakdown(BaseModel):
    """Breakdown by first summer year (cohort analysis).

    Shows how many current campers started in each year.
    """

    first_summer_year: int = Field(description="Year camper first attended summer camp")
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


class RetentionByFirstYear(BaseModel):
    """Retention metrics by first year attended."""

    first_year: int = Field(description="Year camper first attended camp")
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
    """Retention metrics by number of summer enrollment years.

    Calculated from actual attendees table enrollment history,
    not the potentially incorrect years_at_camp field in persons.
    """

    summer_years: int = Field(description="Number of summer years enrolled")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByFirstSummerYear(BaseModel):
    """Retention metrics by first summer year (cohort analysis).

    Shows retention by when campers first joined summer camp,
    enabling cohort-based retention analysis.
    """

    first_summer_year: int = Field(description="Year camper first attended summer camp")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionByPriorSession(BaseModel):
    """Retention metrics by prior year session.

    Shows retention rate broken down by what session campers
    were enrolled in during the prior year.
    """

    prior_session: str = Field(description="Session name from prior year")
    base_count: int = Field(description="Count in base year")
    returned_count: int = Field(description="Count that returned in compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionMetricsResponse(BaseModel):
    """Response model for retention metrics endpoint."""

    base_year: int = Field(description="Base year for comparison")
    compare_year: int = Field(description="Comparison year")
    base_year_total: int = Field(description="Total enrolled in base year")
    compare_year_total: int = Field(description="Total enrolled in compare year")
    returned_count: int = Field(description="Number who returned from base year")
    overall_retention_rate: float = Field(description="Overall retention rate (0-1)")

    by_gender: list[RetentionByGender] = Field(description="Retention by gender")
    by_grade: list[RetentionByGrade] = Field(description="Retention by grade")
    by_session: list[RetentionBySession] = Field(description="Retention by base year session")
    by_years_at_camp: list[RetentionByYearsAtCamp] = Field(description="Retention by years at camp")
    # New demographic breakdowns (from camper_history)
    by_school: list[RetentionBySchool] = Field(default_factory=list, description="Retention by school")
    by_city: list[RetentionByCity] = Field(default_factory=list, description="Retention by city")
    by_synagogue: list[RetentionBySynagogue] = Field(default_factory=list, description="Retention by synagogue")
    by_first_year: list[RetentionByFirstYear] = Field(
        default_factory=list, description="Retention by first year attended"
    )
    by_session_bunk: list[RetentionBySessionBunk] = Field(
        default_factory=list, description="Retention by session+bunk combination"
    )
    # New breakdowns for retention tab redesign (calculated from attendees history)
    by_summer_years: list[RetentionBySummerYears] = Field(
        default_factory=list, description="Retention by summer enrollment years (calculated from attendees)"
    )
    by_first_summer_year: list[RetentionByFirstSummerYear] = Field(
        default_factory=list, description="Retention by first summer year (cohort analysis)"
    )
    by_prior_session: list[RetentionByPriorSession] = Field(
        default_factory=list, description="Retention by prior year session"
    )


# ============================================================================
# Registration Metrics
# ============================================================================


class RegistrationMetricsResponse(BaseModel):
    """Response model for registration metrics endpoint."""

    year: int = Field(description="Year for metrics")
    total_enrolled: int = Field(description="Total enrolled campers")
    total_waitlisted: int = Field(description="Total waitlisted campers")
    total_cancelled: int = Field(description="Total cancelled registrations")

    by_gender: list[GenderBreakdown] = Field(description="Enrollment by gender")
    by_grade: list[GradeBreakdown] = Field(description="Enrollment by grade")
    by_session: list[SessionBreakdown] = Field(description="Enrollment by session")
    by_session_length: list[SessionLengthBreakdown] = Field(description="Enrollment by session length")
    by_years_at_camp: list[YearsAtCampBreakdown] = Field(description="Enrollment by years at camp")
    new_vs_returning: NewVsReturning = Field(description="New vs returning breakdown")
    # New breakdowns (from camper_history)
    by_school: list[SchoolBreakdown] = Field(default_factory=list, description="Enrollment by school")
    by_city: list[CityBreakdown] = Field(default_factory=list, description="Enrollment by city")
    by_synagogue: list[SynagogueBreakdown] = Field(default_factory=list, description="Enrollment by synagogue")
    by_first_year: list[FirstYearBreakdown] = Field(
        default_factory=list, description="Enrollment by first year attended"
    )
    by_session_bunk: list[SessionBunkBreakdown] = Field(
        default_factory=list, description="Top session+bunk combinations"
    )
    # New breakdowns for registration tab redesign
    by_gender_grade: list[GenderByGradeBreakdown] = Field(
        default_factory=list, description="Gender breakdown by grade (for stacked bar chart)"
    )
    by_summer_years: list[SummerYearsBreakdown] = Field(
        default_factory=list, description="Enrollment by summer years (calculated from attendees)"
    )
    by_first_summer_year: list[FirstSummerYearBreakdown] = Field(
        default_factory=list, description="Enrollment by first summer year (cohort analysis)"
    )


# ============================================================================
# Comparison Metrics
# ============================================================================


class YearSummary(BaseModel):
    """Summary metrics for a single year."""

    year: int = Field(description="Year")
    total: int = Field(description="Total enrolled")
    by_gender: list[GenderBreakdown] = Field(description="By gender")
    by_grade: list[GradeBreakdown] = Field(description="By grade")


class ComparisonDelta(BaseModel):
    """Delta between two years."""

    total_change: int = Field(description="Change in total enrollment")
    percentage_change: float = Field(description="Percentage change")


class ComparisonMetricsResponse(BaseModel):
    """Response model for comparison metrics endpoint."""

    year_a: YearSummary = Field(description="First year summary")
    year_b: YearSummary = Field(description="Second year summary")
    delta: ComparisonDelta = Field(description="Change between years")


# ============================================================================
# Historical Trends Metrics
# ============================================================================


class YearMetrics(BaseModel):
    """Summary metrics for a single year in historical trends."""

    year: int = Field(description="Year")
    total_enrolled: int = Field(description="Total enrolled campers")
    by_gender: list[GenderBreakdown] = Field(description="Enrollment by gender")
    new_vs_returning: NewVsReturning = Field(description="New vs returning breakdown")
    by_first_year: list[FirstYearBreakdown] = Field(
        default_factory=list, description="Enrollment by first year attended"
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


class YearEnrollment(BaseModel):
    """Enrollment breakdown for a single year."""

    year: int = Field(description="Year")
    total: int = Field(description="Total enrolled")
    by_gender: list[GenderEnrollment] = Field(description="Enrollment by gender")
    by_grade: list[GradeEnrollment] = Field(description="Enrollment by grade")


# ============================================================================
# Retention Trends (3-Year View)
# ============================================================================


class RetentionTrendValue(BaseModel):
    """A single retention rate value for a year transition."""

    from_year: int = Field(description="Base year")
    to_year: int = Field(description="Compare year")
    retention_rate: float = Field(description="Retention rate (0-1)")


class RetentionTrendGenderBreakdown(BaseModel):
    """Gender retention across multiple year transitions."""

    gender: str = Field(description="Gender (M, F, or other)")
    values: list[RetentionTrendValue] = Field(description="Retention for each year transition")


class RetentionTrendGradeBreakdown(BaseModel):
    """Grade retention across multiple year transitions."""

    grade: int | None = Field(description="Grade level")
    values: list[RetentionTrendValue] = Field(description="Retention for each year transition")


class RetentionTrendYear(BaseModel):
    """Retention metrics for a single year transition."""

    from_year: int = Field(description="Base year")
    to_year: int = Field(description="Compare year")
    retention_rate: float = Field(description="Overall retention rate (0-1)")
    base_count: int = Field(description="Total campers in base year")
    returned_count: int = Field(description="Campers who returned")
    by_gender: list[RetentionByGender] = Field(default_factory=list, description="Retention by gender")
    by_grade: list[RetentionByGrade] = Field(default_factory=list, description="Retention by grade")


class RetentionTrendsResponse(BaseModel):
    """Response model for retention trends endpoint (3-year view)."""

    years: list[RetentionTrendYear] = Field(description="Retention data for each year transition")
    avg_retention_rate: float = Field(description="Average retention rate across all transitions")
    trend_direction: str = Field(description="Trend direction: 'improving', 'declining', or 'stable'")
    # Optional: grouped breakdowns for charts
    by_gender_grouped: list[RetentionTrendGenderBreakdown] = Field(
        default_factory=list, description="Gender retention grouped across years"
    )
    by_grade_grouped: list[RetentionTrendGradeBreakdown] = Field(
        default_factory=list, description="Grade retention grouped across years"
    )
    # Enrollment counts per year for 3-year comparison charts
    enrollment_by_year: list[YearEnrollment] = Field(
        default_factory=list, description="Enrollment counts per year for 3-year comparison"
    )


# ============================================================================
# Drilldown (Chart Click-Through)
# ============================================================================


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
    years_at_camp: int | None = Field(None, description="Years at camp")
    session_name: str = Field(description="Session name")
    session_cm_id: int = Field(description="Session CampMinder ID")
    status: str = Field(description="Enrollment status")
    is_returning: bool = Field(False, description="Whether camper is returning (years_at_camp > 1)")
