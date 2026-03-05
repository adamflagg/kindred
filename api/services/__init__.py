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
    # Breakdown calculator
    "BreakdownStats",
    # Existing
    "IDLookupCache",
    # Repository
    "MetricsRepository",
    "RegistrationBreakdownStats",
    # Services
    "RetentionService",
    "calculate_percentage",
    "compute_breakdown",
    "compute_registration_breakdown",
    "extract_city",
    # Extractors
    "extract_gender",
    "extract_grade",
    "extract_school",
    "extract_synagogue",
    "extract_years_at_camp",
    "safe_rate",
]
