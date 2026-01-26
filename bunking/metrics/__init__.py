"""Metrics module for camper retention and history analytics.

This module previously contained Python implementations for computing camper history.
The computation has been moved to a native Go implementation in pocketbase/sync/camper_history.go
for better performance and consistency with other sync services.
"""

__all__: list[str] = []
