"""
Internal Router - Service-to-service endpoints for Go → Python calls.

These endpoints are NOT authenticated (auth middleware skips /api/internal/ prefix).
They are only accessible on the Docker internal network. Caddy blocks external access.
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.constants.geo import GeoCategory
from bunking.geo_normalizer.normalizer import normalize_values
from bunking.logging_config import TRACE, get_logger
from bunking.sync.bunk_request_processor.data.repositories import SessionRepository
from bunking.sync.bunk_request_processor.process_requests import (
    load_configuration,
    process_bunk_requests,
)
from bunking.sync.bunk_request_processor.shared.constants import validate_source_fields
from pocketbase import PocketBase

logger = get_logger(__name__)

router = APIRouter(prefix="/api/internal", tags=["internal"])


# --- Geo Normalize ---


class GeoValue(BaseModel):
    value: str
    state: str = ""
    country: str = ""


class GeoNormalizeRequest(BaseModel):
    category: GeoCategory
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


# --- Process Requests ---


class ProcessRequestsRequest(BaseModel):
    year: int
    session: str = "all"
    source_fields: list[str] | None = None
    limit: int = 0
    clear_existing: bool = False
    force: bool = False
    debug: bool = False
    trace: bool = False
    collect_traces: bool = False
    trigger: str = "manual"


class ProcessRequestsResponse(BaseModel):
    success: bool
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    already_processed: int = 0
    error: str | None = None
    warnings: list[str] = []
    phase1_failed: int = 0


async def run_process_requests(
    *,
    year: int,
    session: str,
    source_fields: list[str] | None,
    limit: int,
    clear_existing: bool,
    force: bool,
    debug: bool,
    trace: bool,
    collect_traces: bool = False,
    trigger: str = "manual",
) -> dict[str, Any]:
    """Run the bunk request processor. Extracted for testability."""
    # Configure logging level (same as process_requests.py CLI)
    if trace:
        log_level = TRACE
    elif debug:
        log_level = logging.DEBUG
    else:
        log_level = logging.INFO
    logging.getLogger("bunking").setLevel(log_level)
    if not trace:
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)
        logging.getLogger("openai").setLevel(logging.WARNING)

    # Validate source fields
    validated_fields = None
    if source_fields:
        validated_fields = validate_source_fields(source_fields)

    # Authenticate with PocketBase
    config = load_configuration()
    pb_client = PocketBase(config["pb_url"])
    pb_client.collection("_superusers").auth_with_password(config["pb_email"], config["pb_password"])

    session_repo = SessionRepository(pb_client)
    session_cm_ids = await asyncio.to_thread(session_repo.resolve_session_cm_ids, session, year)

    return await process_bunk_requests(
        data_source="database",
        year=year,
        session_cm_ids=session_cm_ids,
        test_limit=limit if limit > 0 else None,
        clear_existing=clear_existing,
        force=force,
        source_fields=validated_fields,
        debug=debug,
        collect_traces=collect_traces,
        trigger=trigger,
    )


@router.post("/process-requests", response_model=ProcessRequestsResponse)
async def process_requests(body: ProcessRequestsRequest) -> JSONResponse:
    """Process bunk requests from original_bunk_requests → bunk_requests.

    Called by PocketBase's process_requests sync service.
    Replaces the former Python subprocess call. Long-running (up to 30 min).
    """
    logger.info(
        f"Processing requests: year={body.year}, session={body.session}, "
        f"limit={body.limit}, clear_existing={body.clear_existing}, force={body.force}"
    )

    try:
        result = await run_process_requests(
            year=body.year,
            session=body.session,
            source_fields=body.source_fields,
            limit=body.limit,
            clear_existing=body.clear_existing,
            force=body.force,
            debug=body.debug,
            trace=body.trace,
            collect_traces=body.collect_traces,
            trigger=body.trigger,
        )

        stats = result.get("statistics", {})
        phase1_failed = stats.get("phase1_failed", 0)
        phase1_successful = stats.get("phase1_successful", 0)
        phase1_first_error = stats.get("phase1_first_error")

        # Build warnings for AI parse failures (denominator is AI-only, excludes pre-parsed)
        warnings: list[str] = []
        if phase1_failed > 0 and phase1_first_error:
            ai_total = phase1_failed + phase1_successful
            warnings.append(f"{phase1_failed}/{ai_total} AI parse requests failed: {phase1_first_error}")

        return JSONResponse(
            status_code=200,
            content={
                "success": result.get("success", False),
                "created": stats.get("requests_created", 0),
                "updated": 0,
                "skipped": stats.get("phase2_ambiguous", 0),
                "errors": 0 if result.get("success") else 1,
                "already_processed": result.get("already_processed", 0),
                "warnings": warnings,
                "phase1_failed": phase1_failed,
            },
        )

    except Exception as e:
        logger.error(f"Process requests failed: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e),
                "created": 0,
                "updated": 0,
                "skipped": 0,
                "errors": 1,
                "already_processed": 0,
            },
        )
