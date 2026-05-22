"""Pydantic models for Day 1 registration response."""

from pydantic import BaseModel, Field


class Day1CategoryCounts(BaseModel):
    count: int = Field(description="Number of enrollments in the 24h window")


class Day1Category(BaseModel):
    category: str = Field(description="'at_camp', 'quest', or 'teen'")
    label: str = Field(description="'At Camp', 'Quest', or 'Teens'")
    count: int = Field(description="Enrollments in the 24h window for this category")


class Day1TierData(BaseModel):
    tier: str = Field(description="'priority', 'early', or 'open'")
    tier_label: str = Field(description="'Priority Registration'")
    date: str = Field(description="ISO date of the tier opening")
    window_start: str = Field(description="ISO datetime with timezone")
    window_end: str = Field(description="ISO datetime with timezone")
    categories: list[Day1Category]
    total: Day1CategoryCounts
    approximate: bool = Field(False, description="True when using date-only fallback")


class Day1YearData(BaseModel):
    year: int
    tiers: list[Day1TierData]


class Day1Response(BaseModel):
    year: int
    tiers: list[Day1TierData]
    prior_years: list[Day1YearData] = Field(default_factory=list, description="2 prior years")
