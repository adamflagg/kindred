"""Metrics module for camper retention and history analytics.

This module previously contained Python implementations for computing camper history,
later a native Go implementation (pocketbase/sync/camper_history.go). Both are gone:
the camper_history table had no live consumers outside its own writer (see #2369) and
was dropped outright. Retention/registration metrics are computed directly from
attendees + persons (api/services/historical_service.py, api/services/registration_service.py).
"""

__all__: list[str] = []
