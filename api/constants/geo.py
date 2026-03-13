"""Geographic normalization constants."""

from enum import Enum


class GeoCategory(str, Enum):
    """Valid categories for geographic normalization.

    Used across routers, services, and the normalizer to ensure
    category values are constrained to known types.
    """

    CITY = "city"
    SCHOOL = "school"
    CONGREGATION = "congregation"
