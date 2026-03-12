"""
Internal Router - Service-to-service endpoints for Go → Python calls.

These endpoints are NOT authenticated (auth middleware skips /api/internal/ prefix).
They are only accessible on the Docker internal network. Caddy blocks external access.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from bunking.geo_normalizer.normalizer import normalize_values

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal", tags=["internal"])


# --- Geo Normalize ---


class GeoValue(BaseModel):
    value: str
    state: str = ""
    country: str = ""


class GeoNormalizeRequest(BaseModel):
    category: Literal["city", "school", "congregation"]
    values: list[GeoValue]


@router.post("/geo-normalize")
async def geo_normalize(body: GeoNormalizeRequest) -> dict[str, Any]:
    """Normalize geographic values using fuzzy matching.

    Called by PocketBase's normalize_geographic sync service.
    Replaces the former Python subprocess call.
    """
    if not body.values:
        return {}

    # Convert to the format expected by normalize_values
    values_list = [{"value": v.value, "state": v.state, "country": v.country} for v in body.values]

    logger.info(f"Normalizing {len(values_list)} {body.category} values")

    result = normalize_values(body.category, values_list)

    logger.info(f"Normalized {len(result)} values")
    return result
