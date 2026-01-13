"""Test CampMinder age format handling

CampMinder uses a special age format where X.YY represents:
- X = years
- YY = months (00-11, not 00-99)"""

from datetime import date

import pytest

from bunking.sync.bunk_request_processor.utils.campminder_age import CampMinderAge


class TestCampMinderAge:
    """Test CampMinder age format handling"""

    def test_create_from_components(self):
        """Test creating CampMinder age from years and months"""
        # Given: Years and months
        age = CampMinderAge(10, 3)

        # Then: Should create correct age
        assert age.years == 10
        assert age.months == 3
        assert str(age) == "10.03"
        assert float(age) == 10.03

    def test_create_from_float(self):
        """Test creating CampMinder age from float"""
        # Given: Float representation
        age = CampMinderAge.from_float(10.11)

        # Then: Should parse correctly
        assert age.years == 10
        assert age.months == 11

    def test_invalid_month_raises_error(self):
        """Test that invalid months raise error"""
        # Given: Invalid month value
        # Then: Should raise ValueError
        with pytest.raises(ValueError, match="Months must be 0-11"):
            CampMinderAge(10, 12)

    def test_addition(self):
        """Test adding months to CampMinder age"""
        # Test simple addition
        age = CampMinderAge(10, 3)
        new_age = age.add_months(2)
        assert str(new_age) == "10.05"

        # Test year rollover
        age = CampMinderAge(10, 11)
        new_age = age.add_months(1)
        assert str(new_age) == "11.00"

        # Test multiple year rollover
        age = CampMinderAge(10, 9)
        new_age = age.add_months(15)  # 9 + 15 = 24 months = 2 years
        assert str(new_age) == "12.00"

    def test_subtraction(self):
        """Test subtracting months from CampMinder age"""
        # Test simple subtraction
        age = CampMinderAge(10, 5)
        new_age = age.subtract_months(2)
        assert str(new_age) == "10.03"

        # Test year rollback
        age = CampMinderAge(11, 0)
        new_age = age.subtract_months(1)
        assert str(new_age) == "10.11"

        # Test multiple year rollback
        age = CampMinderAge(12, 2)
        new_age = age.subtract_months(26)  # 2 years and 2 months
        assert str(new_age) == "10.00"

    def test_age_difference(self):
        """Test calculating difference between two ages"""
        # Test same year
        age1 = CampMinderAge(10, 8)
        age2 = CampMinderAge(10, 3)
        assert age1.difference_months(age2) == 5

        # Test different years
        age1 = CampMinderAge(11, 2)
        age2 = CampMinderAge(10, 8)
        assert age1.difference_months(age2) == 6  # 4 months to 11.0 + 2 months

        # Test negative difference
        age1 = CampMinderAge(10, 3)
        age2 = CampMinderAge(10, 8)
        assert age1.difference_months(age2) == -5

    def test_comparison(self):
        """Test comparing CampMinder ages"""
        age1 = CampMinderAge(10, 3)
        age2 = CampMinderAge(10, 8)
        age3 = CampMinderAge(10, 3)
        age4 = CampMinderAge(11, 0)

        assert age1 < age2
        assert age2 > age1
        assert age1 == age3
        assert age1 <= age3
        assert age2 < age4

    def test_from_birthdate(self):
        """Test calculating CampMinder age from birthdate"""
        # Given: A birthdate and reference date
        birthdate = date(2010, 3, 15)
        reference_date = date(2020, 7, 1)  # 10 years, 3 months, 16 days

        # When: Calculating age
        age = CampMinderAge.from_birthdate(birthdate, reference_date)

        # Then: Should calculate correctly (rounds down to complete months)
        assert age.years == 10
        assert age.months == 3

    def test_spread_calculation(self):
        """Test age spread calculations"""
        # Given: Age 10.03 with spread of 24 months (2.00)
        age = CampMinderAge(10, 3)

        # When: Calculating spread range
        min_age = age.subtract_months(12)  # Half of spread
        max_age = age.add_months(12)  # Half of spread

        # Then: Range should be 9.03 to 11.03
        assert str(min_age) == "9.03"
        assert str(max_age) == "11.03"

    def test_string_parsing(self):
        """Test parsing CampMinder age from string"""
        # Test various formats
        age = CampMinderAge.from_string("10.03")
        assert age.years == 10
        assert age.months == 3

        age = CampMinderAge.from_string("9.11")
        assert age.years == 9
        assert age.months == 11

        # Test invalid formats
        with pytest.raises(ValueError):
            CampMinderAge.from_string("10.12")  # Invalid month

        with pytest.raises(ValueError):
            CampMinderAge.from_string("10.99")  # Invalid month
