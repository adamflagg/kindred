"""
API Services - Business logic and data access for the Bunking API.

Services encapsulate complex operations that are used by multiple routers.

Note: SessionContext has circular dependency issues (session_utils → dependencies).
Import directly in routers to avoid import errors:
    from api.services.session_context import SessionContext, build_session_context
"""

from .breakdown_calculator import (
    BreakdownStats,
    RegistrationBreakdownStats,
    calculate_percentage,
    compute_breakdown,
    compute_registration_breakdown,
    safe_rate,
)
from .extractors import (
    extract_city,
    extract_first_year_attended,
    extract_gender,
    extract_grade,
    extract_school,
    extract_synagogue,
    extract_years_at_camp,
)
from .id_cache import IDLookupCache
from .metrics_repository import MetricsRepository
from .retention_service import RetentionService

__all__ = [
    # Existing
    "IDLookupCache",
    # Repository
    "MetricsRepository",
    # Services
    "RetentionService",
    # Breakdown calculator
    "BreakdownStats",
    "RegistrationBreakdownStats",
    "compute_breakdown",
    "compute_registration_breakdown",
    "safe_rate",
    "calculate_percentage",
    # Extractors
    "extract_gender",
    "extract_grade",
    "extract_school",
    "extract_city",
    "extract_synagogue",
    "extract_years_at_camp",
    "extract_first_year_attended",
]
