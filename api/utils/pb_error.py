"""Utility to map upstream PocketBase ClientResponseError to FastAPI HTTPException.

When PocketBase returns a 4xx or 5xx, the API should propagate a meaningful
status code rather than flattening everything to 500 via the global handler.

Mapping rationale:
- 404: record not found — pass through as 404
- 400: bad request / validation error from PB — pass through as 400
- 401/403: PocketBase auth/permission failure — map to 403 (client should not
           retry with the same credentials; this is an authorization boundary)
- 5xx: PocketBase itself is unhealthy — surface as 502 Bad Gateway (upstream error)

Error detail is intentionally generic — PocketBase internal messages (field names,
schema details, internal IDs) must not be exposed to API consumers.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

logger = logging.getLogger(__name__)


def pb_error_to_http(error: ClientResponseError) -> HTTPException:
    """Convert a PocketBase ClientResponseError into a FastAPI HTTPException.

    The returned exception carries a safe, generic detail string.
    Call ``raise pb_error_to_http(e)`` instead of ``raise e`` in
    ``except ClientResponseError`` handlers that proxy PocketBase calls.

    Args:
        error: The ClientResponseError raised by the pocketbase library.

    Returns:
        HTTPException with an appropriate status code and generic detail.
    """
    status = error.status

    if status == 404:
        return HTTPException(status_code=404, detail="Resource not found")
    if status == 400:
        return HTTPException(status_code=400, detail="Invalid request")
    if status in (401, 403):
        return HTTPException(status_code=403, detail="Forbidden")
    # Any PocketBase 5xx → 502 Bad Gateway (upstream failure, not our fault)
    if status >= 500:
        return HTTPException(status_code=502, detail="Upstream service error")
    # Fallback for unexpected statuses (e.g. 429 rate-limited, other non-standard codes)
    logger.warning("pb_error_to_http: unexpected upstream status %d", status)
    return HTTPException(status_code=502, detail="Upstream service error")
