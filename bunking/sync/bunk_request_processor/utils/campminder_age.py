"""CampMinder age format handling

CampMinder uses a special age format where X.YY represents:
- X = years
- YY = months (00-11, not 00-99)

Examples:
- 10.03 = 10 years and 3 months
- 10.11 = 10 years and 11 months
- 11.00 = 11 years and 0 months (next value after 10.11)"""

from __future__ import annotations

from datetime import date


class CampMinderAge:
    """Represents and manipulates ages in CampMinder format"""

    def __init__(self, years: int, months: int):
        """Create a CampMinder age

        Args:
            years: Number of years
            months: Number of months (0-11)

        Raises:
            ValueError: If months is not 0-11
        """
        if not 0 <= months <= 11:
            raise ValueError(f"Months must be 0-11, got {months}")

        self.years = years
        self.months = months

    @classmethod
    def from_float(cls, age_float: float) -> CampMinderAge:
        """Create from float representation

        Args:
            age_float: Age in format like 10.03

        Returns:
            CampMinderAge instance
        """
        years = int(age_float)
        # Extract decimal part and convert to months
        decimal_part = round((age_float - years) * 100)

        if decimal_part > 11:
            raise ValueError(f"Invalid CampMinder age: {age_float} (months part must be 00-11)")

        return cls(years, decimal_part)

    @classmethod
    def from_string(cls, age_str: str) -> CampMinderAge:
        """Create from string representation

        Args:
            age_str: Age in format like "10.03"

        Returns:
            CampMinderAge instance
        """
        return cls.from_float(float(age_str))

    @classmethod
    def from_birthdate(cls, birthdate: date, reference_date: date | None = None) -> CampMinderAge:
        """Calculate CampMinder age from birthdate

        Args:
            birthdate: Date of birth
            reference_date: Date to calculate age at (defaults to today)

        Returns:
            CampMinderAge instance
        """
        if reference_date is None:
            reference_date = date.today()

        # Calculate years
        years = reference_date.year - birthdate.year

        # Calculate months
        months = reference_date.month - birthdate.month

        # Adjust for partial months (haven't reached the day of birth yet this month)
        if reference_date.day < birthdate.day:
            months -= 1

        # Adjust if months went negative
        if months < 0:
            years -= 1
            months += 12

        return cls(years, months)

    def add_months(self, months: int) -> CampMinderAge:
        """Add months to this age

        Args:
            months: Number of months to add

        Returns:
            New CampMinderAge instance
        """
        total_months = self.years * 12 + self.months + months
        new_years = total_months // 12
        new_months = total_months % 12
        return CampMinderAge(new_years, new_months)

    def subtract_months(self, months: int) -> CampMinderAge:
        """Subtract months from this age

        Args:
            months: Number of months to subtract

        Returns:
            New CampMinderAge instance
        """
        return self.add_months(-months)

    def difference_months(self, other: CampMinderAge) -> int:
        """Calculate difference in months between two ages

        Args:
            other: Age to compare to

        Returns:
            Difference in months (positive if self > other)
        """
        self_total = self.years * 12 + self.months
        other_total = other.years * 12 + other.months
        return self_total - other_total

    def __str__(self) -> str:
        """String representation in CampMinder format"""
        return f"{self.years}.{self.months:02d}"

    def __float__(self) -> float:
        return self.years + (self.months / 100)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, CampMinderAge):
            return NotImplemented
        return self.years == other.years and self.months == other.months

    def __lt__(self, other: CampMinderAge) -> bool:
        if not isinstance(other, CampMinderAge):
            return NotImplemented
        return (self.years, self.months) < (other.years, other.months)

    def __le__(self, other: CampMinderAge) -> bool:
        if not isinstance(other, CampMinderAge):
            return NotImplemented
        return (self.years, self.months) <= (other.years, other.months)

    def __gt__(self, other: CampMinderAge) -> bool:
        if not isinstance(other, CampMinderAge):
            return NotImplemented
        return (self.years, self.months) > (other.years, other.months)

    def __ge__(self, other: CampMinderAge) -> bool:
        if not isinstance(other, CampMinderAge):
            return NotImplemented
        return (self.years, self.months) >= (other.years, other.months)

    def __repr__(self) -> str:
        return f"CampMinderAge({self.years}, {self.months})"
