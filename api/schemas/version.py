"""GET /api/version: the version this api image was built at.

CD rebuilds only the images whose files changed and retags the rest, so each
component reports its own version and the frontend shows the newest.
"""

from __future__ import annotations

from pydantic import BaseModel


class ApiVersionResponse(BaseModel):
    api: str
