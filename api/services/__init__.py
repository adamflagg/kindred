"""
API Services - Business logic and data access for the Bunking API.

Services encapsulate complex operations that are used by multiple routers.

Note: SessionContext has circular dependency issues (session_utils → dependencies).
Import directly in routers to avoid import errors:
    from api.services.session_context import SessionContext, build_session_context
"""

from .id_cache import IDLookupCache

__all__ = [
    "IDLookupCache",
]
