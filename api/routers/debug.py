"""Debug Router - Debug tools for pipeline analysis, Phase 1 AI parse iteration, and on-demand phase execution."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from bunking.auth_middleware import AuthUser
from bunking.logging_config import get_logger
from bunking.rbac.dependencies import require_admin
from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
    DebugParseRepository,
)
from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
    SessionRepository,
)
from bunking.sync.bunk_request_processor.debug.phase_runner import PHASE_ORDER
from bunking.sync.bunk_request_processor.debug.trace_collector import TraceCollector
from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
    OriginalRequestsLoader,
)
from bunking.sync.bunk_request_processor.prompts.loader import (
    clear_cache as clear_prompt_cache,
)
from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
    Phase1DebugService,
)

from ..constants.collections import (
    ATTENDEES,
    BUNK_REQUESTS,
    DEBUG_PIPELINE_RUNS,
    DEBUG_PIPELINE_SUMMARY,
    DEBUG_PIPELINE_TRACES,
    ORIGINAL_BUNK_REQUESTS,
)
from ..constants.filters import ACTIVE_ENROLLED_FILTER
from ..dependencies import pb
from ..schemas.debug import (
    CamperGroupedRequests,
    ClearAnalysisResponse,
    DualSourceParseResult,
    FieldParseResult,
    GroupedRequestsResponse,
    OriginalRequestItem,
    OriginalRequestsListResponse,
    OriginalRequestsWithParseResponse,
    OriginalRequestWithStatus,
    ParseAnalysisDetailItem,
    ParseAnalysisItem,
    ParseAnalysisListResponse,
    ParsedIntent,
    ParseResultData,
    ParseResultWithSource,
    Phase1OnlyRequest,
    Phase1OnlyResponse,
    ProductionRequestItem,
    ProductionRequestsResponse,
    PromptContentResponse,
    PromptListItem,
    PromptListResponse,
    PromptUpdateRequest,
    PromptUpdateResponse,
    SourceFieldType,
)
from ..schemas.pipeline_debug import (
    PersonSearchItem,
    PersonSearchResponse,
    PhaseRunResponse,
    PinToggleResponse,
    PipelineRunItem,
    PipelineRunsResponse,
    PipelineSummaryItem,
    PipelineSummaryResponse,
    PipelineTraceItem,
    PipelineTraceResponse,
    PipelineTracesByCamperResponse,
    RunFromPhaseRequest,
    RunFullTraceRequest,
    RunPhase1Request,
    RunPhase2Request,
    RunPhase3Request,
)
from ..settings import get_settings
from ..utils.pb_error import pb_error_to_http
from ..utils.pb_filters import pb_escape
from ..utils.session_metrics import get_person_from_expand, get_session_from_expand

logger = get_logger(__name__)

router = APIRouter(prefix="/api/debug", tags=["debug"])


def _build_parsed_intent(intent: dict[str, Any]) -> ParsedIntent:
    """Build a ParsedIntent schema from a raw intent dict.

    Centralizes the repeated ParsedIntent construction pattern used
    across 8 call sites in this module.

    Args:
        intent: Dictionary with intent fields from AI parse results.

    Returns:
        ParsedIntent schema instance with defaults for missing fields.
    """
    return ParsedIntent(
        request_type=intent.get("request_type", "unknown"),
        target_name=intent.get("target_name"),
        keywords_found=intent.get("keywords_found", []),
        parse_notes=intent.get("parse_notes", ""),
        reasoning=intent.get("reasoning", ""),
        list_position=intent.get("list_position", 0),
        needs_clarification=intent.get("needs_clarification", False),
        temporal_info=intent.get("temporal_info"),
    )


# Prompts directory - relative to project root
PROMPTS_DIR = Path(__file__).parent.parent.parent / "config" / "prompts"

# Valid prompt name pattern (alphanumeric with underscores only)
VALID_PROMPT_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")


# Dependency functions for repository injection (mockable in tests)
def get_debug_parse_repository() -> DebugParseRepository:
    """Get a DebugParseRepository instance."""
    return DebugParseRepository(pb)


def get_session_repository() -> SessionRepository:
    """Get a SessionRepository instance."""
    return SessionRepository(pb)


class BunkRequestsRepository:
    """Simple repository for fetching bunk_requests for debug display."""

    def __init__(self, pb_client: Any) -> None:
        """Initialize with PocketBase client."""
        self.pb = pb_client

    def find_by_requester(
        self,
        camper_cm_id: int,
        *,
        year: int,
        session_cm_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """Find all bunk_requests for a camper.

        Args:
            camper_cm_id: CampMinder ID of the requester
            year: Year to filter by
            session_cm_id: Optional session filter

        Returns:
            List of bunk_request records as dicts
        """
        import json

        filter_parts = [
            f"requester_id = {camper_cm_id}",
            f"year = {year}",
            'merged_into = ""',  # Exclude soft-deleted/merged requests
        ]

        if session_cm_id is not None:
            filter_parts.append(f"session_id = {session_cm_id}")

        filter_str = " && ".join(filter_parts)

        try:
            result = self.pb.collection(BUNK_REQUESTS).get_full_list(
                query_params={"filter": filter_str, "sort": "source_field,created"}
            )

            # Convert PocketBase records to dicts
            records = []
            for item in result:
                # Parse JSON fields
                keywords = []
                if hasattr(item, "keywords_found") and item.keywords_found:
                    if isinstance(item.keywords_found, list):
                        keywords = item.keywords_found
                    elif isinstance(item.keywords_found, str):
                        try:
                            keywords = json.loads(item.keywords_found)
                        except json.JSONDecodeError:
                            pass

                ai_p1 = None
                if hasattr(item, "ai_p1_reasoning") and item.ai_p1_reasoning:
                    if isinstance(item.ai_p1_reasoning, dict):
                        ai_p1 = item.ai_p1_reasoning
                    elif isinstance(item.ai_p1_reasoning, str):
                        try:
                            ai_p1 = json.loads(item.ai_p1_reasoning)
                        except json.JSONDecodeError:
                            pass

                records.append(
                    {
                        "id": item.id,
                        "requester_id": getattr(item, "requester_id", None),
                        "requestee_id": getattr(item, "requestee_id", None),
                        "requested_person_name": getattr(item, "requested_person_name", None),
                        "request_type": getattr(item, "request_type", None),
                        "source_field": getattr(item, "source_field", None),
                        "confidence_score": getattr(item, "confidence_score", None),
                        "confidence_level": getattr(item, "confidence_level", None),
                        "keywords_found": keywords,
                        "parse_notes": getattr(item, "parse_notes", None),
                        "ai_p1_reasoning": ai_p1,
                        "status": getattr(item, "status", None),
                        "is_active": getattr(item, "is_active", None),
                        "original_text": getattr(item, "original_text", None),
                    }
                )

            return records

        except Exception as e:
            logger.warning(f"Error finding bunk_requests for requester {camper_cm_id}: {e}")
            return []


def get_bunk_requests_repository() -> BunkRequestsRepository:
    """Get a BunkRequestsRepository instance."""
    return BunkRequestsRepository(pb)


def get_original_requests_loader() -> OriginalRequestsLoader:
    """Get an OriginalRequestsLoader instance."""
    settings = get_settings()
    # Use current year from settings or default to 2025
    year = getattr(settings, "current_year", 2025)
    loader = OriginalRequestsLoader(pb, year)
    loader.load_persons_cache()
    return loader


async def get_phase1_debug_service() -> Phase1DebugService:
    """Get a Phase1DebugService instance.

    Note: This lazily creates the service with all dependencies.
    In production, you might want to cache this or use proper DI.
    """
    import os

    from bunking.sync.bunk_request_processor.integration.batch_processor import (
        BatchProcessor,
    )
    from bunking.sync.bunk_request_processor.integration.provider_factory import (
        ProviderFactory,
    )
    from bunking.sync.bunk_request_processor.services.context_builder import (
        ContextBuilder,
    )
    from bunking.sync.bunk_request_processor.services.phase1_parse_service import (
        Phase1ParseService,
    )

    # Create AI provider from environment config
    provider_factory = ProviderFactory()
    ai_service = provider_factory.create_from_env()

    # Create context builder
    context_builder = ContextBuilder()

    # Create batch processor
    batch_processor = BatchProcessor(ai_service)

    # Create Phase 1 service
    phase1_service = Phase1ParseService(
        ai_service=ai_service,
        context_builder=context_builder,
        batch_processor=batch_processor,
    )

    # Create debug dependencies
    debug_repo = get_debug_parse_repository()
    loader = get_original_requests_loader()

    # Get prompt version from environment or use default
    prompt_version = os.environ.get("PROMPT_VERSION", "v1.0.0")

    return Phase1DebugService(
        debug_repo=debug_repo,
        original_requests_loader=loader,
        phase1_service=phase1_service,
        prompt_version=prompt_version,
    )


@router.get("/parse-analysis", response_model=ParseAnalysisListResponse)
async def list_parse_analysis(
    session_cm_id: int | None = Query(default=None, description="Filter by session CM ID"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=50, ge=1, le=500, description="Maximum results"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    user: AuthUser = Depends(require_admin),
) -> ParseAnalysisListResponse:
    """List Phase 1 parse analysis results.

    Returns cached debug results with optional filtering by session
    and source field. Results are sorted by creation time (newest first).
    """
    debug_repo = get_debug_parse_repository()

    # Convert session CM ID to PocketBase ID if provided
    session_id: str | None = None
    if session_cm_id:
        session_repo = get_session_repository()
        session = session_repo.find_by_cm_id(session_cm_id)
        if session:
            session_id = session["id"]

    items, total = debug_repo.list_with_originals(
        limit=limit,
        offset=offset,
        session_id=session_id,
        source_field=source_field,
    )

    # Convert to response model
    response_items = []
    for item in items:
        # Convert parsed_intents to proper model
        parsed_intents = [_build_parsed_intent(intent) for intent in item.get("parsed_intents", [])]

        response_items.append(
            ParseAnalysisItem(
                id=item.get("id", ""),
                original_request_id=item.get("original_request_id", ""),
                requester_name=item.get("requester_name"),
                requester_cm_id=item.get("requester_cm_id"),
                source_field=item.get("source_field"),
                original_text=item.get("original_text"),
                parsed_intents=parsed_intents,
                is_valid=item.get("is_valid", True),
                error_message=item.get("error_message"),
                token_count=item.get("token_count"),
                processing_time_ms=item.get("processing_time_ms"),
                prompt_version=item.get("prompt_version"),
                created=_parse_pb_datetime(item.get("created")),
            )
        )

    return ParseAnalysisListResponse(items=response_items, total=total)


@router.get("/parse-analysis/{item_id}", response_model=ParseAnalysisDetailItem)
async def get_parse_analysis_detail(item_id: str, user: AuthUser = Depends(require_admin)) -> ParseAnalysisDetailItem:
    """Get detailed parse analysis result including raw AI response."""
    debug_repo = get_debug_parse_repository()
    item = debug_repo.get_by_id(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Parse analysis result not found")

    # Convert parsed_intents
    parsed_intents = [_build_parsed_intent(intent) for intent in item.get("parsed_intents", [])]

    return ParseAnalysisDetailItem(
        id=item.get("id", ""),
        original_request_id=item.get("original_request_id", ""),
        requester_name=item.get("requester_name"),
        requester_cm_id=item.get("requester_cm_id"),
        source_field=item.get("source_field"),
        original_text=item.get("original_text"),
        parsed_intents=parsed_intents,
        is_valid=item.get("is_valid", True),
        error_message=item.get("error_message"),
        token_count=item.get("token_count"),
        processing_time_ms=item.get("processing_time_ms"),
        prompt_version=item.get("prompt_version"),
        created=_parse_pb_datetime(item.get("created")),
        ai_raw_response=item.get("ai_raw_response"),
    )


@router.post("/parse-phase1-only", response_model=Phase1OnlyResponse)
async def parse_phase1_only(request: Phase1OnlyRequest, user: AuthUser = Depends(require_admin)) -> Phase1OnlyResponse:
    """Run Phase 1 parsing only on selected original_bunk_requests.

    This endpoint runs the AI parsing phase in isolation without
    name resolution (Phase 2) or disambiguation (Phase 3).

    Use this to:
    - Test prompt changes
    - Debug specific parsing issues
    - Iterate on AI prompt without running full pipeline
    """
    debug_service = await get_phase1_debug_service()

    results = await debug_service.parse_selected_records(
        request.original_request_ids,
        force_reparse=request.force_reparse,
    )

    # Calculate total tokens
    total_tokens = sum(r.get("token_count", 0) or 0 for r in results)

    # Convert to response model
    response_items = []
    for item in results:
        parsed_intents = [_build_parsed_intent(intent) for intent in item.get("parsed_intents", [])]

        response_items.append(
            ParseAnalysisItem(
                id=item.get("id", ""),
                original_request_id=item.get("original_request_id", ""),
                requester_name=item.get("requester_name"),
                requester_cm_id=item.get("requester_cm_id"),
                source_field=item.get("source_field"),
                original_text=item.get("original_text"),
                parsed_intents=parsed_intents,
                is_valid=item.get("is_valid", True),
                error_message=item.get("error_message"),
                token_count=item.get("token_count"),
                processing_time_ms=item.get("processing_time_ms"),
                prompt_version=item.get("prompt_version"),
                created=None,
            )
        )

    return Phase1OnlyResponse(results=response_items, total_tokens=total_tokens)


@router.delete("/parse-analysis/by-original/{original_request_id}", response_model=ClearAnalysisResponse)
async def clear_single_parse_analysis(
    original_request_id: str, user: AuthUser = Depends(require_admin)
) -> ClearAnalysisResponse:
    """Clear debug parse result for a single original request.

    Args:
        original_request_id: ID of the original_bunk_requests record
    """
    debug_repo = get_debug_parse_repository()
    deleted = debug_repo.delete_by_original_request(original_request_id)

    return ClearAnalysisResponse(deleted_count=1 if deleted else 0)


@router.delete("/parse-analysis", response_model=ClearAnalysisResponse)
async def clear_parse_analysis(
    session_cm_id: int | None = Query(default=None, description="Filter by session CM ID"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    user: AuthUser = Depends(require_admin),
) -> ClearAnalysisResponse:
    """Clear debug parse analysis results.

    Without filters, clears ALL debug results.
    With filters, only clears results matching the given criteria.
    """
    debug_repo = get_debug_parse_repository()

    # If any filter is provided, use scoped deletion
    if session_cm_id is not None or source_field is not None:
        # Convert session CM ID to PocketBase ID if provided
        session_id: str | None = None
        if session_cm_id:
            session_repo = get_session_repository()
            session = session_repo.find_by_cm_id(session_cm_id)
            if session:
                session_id = session["id"]

        deleted_count = debug_repo.clear_by_filter(
            session_id=session_id,
            source_field=source_field,
        )
    else:
        # No filters - clear all
        deleted_count = debug_repo.clear_all()

    if deleted_count < 0:
        logger.error("clear_parse_analysis: repository returned error sentinel (deleted_count=%d)", deleted_count)
        raise RuntimeError("debug_repo.clear returned error sentinel")

    return ClearAnalysisResponse(deleted_count=deleted_count)


@router.get("/original-requests", response_model=OriginalRequestsListResponse)
async def list_original_requests(
    year: int = Query(description="Year to filter by (required)", ge=2000, le=2100),
    session_cm_id: int | None = Query(default=None, description="Filter by session CM ID"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=50, ge=1, le=500, description="Maximum results"),
    user: AuthUser = Depends(require_admin),
) -> OriginalRequestsListResponse:
    """List original_bunk_requests for debug selection.

    Returns original requests that can be selected for Phase 1 parsing.
    Use this to browse available requests before running parse analysis.
    """
    # Create loader with specified year
    loader = OriginalRequestsLoader(pb, year)
    loader.load_persons_cache()

    records = loader.load_by_filter(
        session_cm_id=session_cm_id,
        source_field=source_field,
        limit=limit,
    )

    items = []
    for record in records:
        first = record.preferred_name or record.first_name
        requester_name = f"{first} {record.last_name}".strip()

        items.append(
            OriginalRequestItem(
                id=record.id,
                requester_name=requester_name,
                requester_cm_id=record.requester_cm_id,
                source_field=record.field,
                original_text=record.content,
                year=record.year,
                processed=record.processed is not None,
            )
        )

    return OriginalRequestsListResponse(items=items, total=len(items))


@router.get("/original-requests/by-camper/{cm_id}", response_model=OriginalRequestsListResponse)
async def list_original_requests_by_camper(
    cm_id: int,
    year: int = Query(description="Camp year", ge=2000, le=2100),
    user: AuthUser = Depends(require_admin),
) -> OriginalRequestsListResponse:
    """List original_bunk_requests for a specific camper by CampMinder ID.

    Looks up the camper via attendees (enrollment is the source of truth,
    scoped by year) rather than persons directly. This ensures the correct
    year's person PB record is used for the original_bunk_requests join.
    """
    # Look up via attendees — enrollment is the source of truth (year-scoped)
    attendee_filter = f"year = {year} && {ACTIVE_ENROLLED_FILTER} && person.cm_id = {cm_id}"
    attendees = pb.collection(ATTENDEES).get_list(1, 1, query_params={"filter": attendee_filter, "expand": "person"})
    if not attendees.items:
        return OriginalRequestsListResponse(items=[], total=0)

    person = get_person_from_expand(attendees.items[0])
    if not person:
        return OriginalRequestsListResponse(items=[], total=0)
    person_pb_id = person.id

    # Query original_bunk_requests directly by requester relation + year
    pb_filter = f'requester = "{person_pb_id}" && year = {year}'
    records = pb.collection(ORIGINAL_BUNK_REQUESTS).get_full_list(
        query_params={"filter": pb_filter, "expand": "requester"}
    )

    items = []
    for record in records:
        expand = getattr(record, "expand", {})
        expanded = expand.get("requester") if isinstance(expand, dict) else None
        first = (getattr(expanded, "preferred_name", None) or getattr(expanded, "first_name", "")) if expanded else ""
        last = getattr(expanded, "last_name", "") if expanded else ""
        requester_name = f"{first} {last}".strip()

        items.append(
            OriginalRequestItem(
                id=record.id,
                requester_name=requester_name,
                requester_cm_id=cm_id,
                source_field=getattr(record, "field", ""),
                original_text=getattr(record, "content", ""),
                year=getattr(record, "year", year),
                processed=getattr(record, "processed", None) is not None,
            )
        )

    return OriginalRequestsListResponse(items=items, total=len(items))


@router.get("/search-persons", response_model=PersonSearchResponse)
async def search_persons(
    q: str = Query(min_length=1, description="Search query for first or last name"),
    year: int = Query(description="Camp year for enrollment filtering", ge=2000, le=2100),
    user: AuthUser = Depends(require_admin),
) -> PersonSearchResponse:
    """Search persons by name with autocomplete support.

    Queries enrolled attendees for the given year with person name matching
    via PocketBase relation-path filters. Returns up to 20 unique persons
    with their enrolled session CM IDs.
    """
    safe_q = pb_escape(q)

    # Query attendees directly — enrollment is the source of truth
    attendee_filter = (
        f"year = {year} && {ACTIVE_ENROLLED_FILTER}"
        f' && (person.first_name ~ "{safe_q}" || person.last_name ~ "{safe_q}")'
    )
    # Cap at 200 rows — enough for 20 unique persons × multiple sessions,
    # while bounding network/memory for broad queries like q=a.
    attendee_results = pb.collection(ATTENDEES).get_list(
        1,
        200,
        query_params={"filter": attendee_filter, "expand": "person,session"},
    )
    attendees = attendee_results.items

    # Group by person cm_id, collecting session CM IDs
    person_data: dict[int, PersonSearchItem] = {}
    for att in attendees:
        person = get_person_from_expand(att)
        session = get_session_from_expand(att)
        if not person:
            continue

        cm_id: int = getattr(person, "cm_id", 0)
        session_cm_id = getattr(session, "cm_id", 0) if session else 0
        if cm_id in person_data:
            if session_cm_id and session_cm_id not in person_data[cm_id].sessions:
                person_data[cm_id].sessions.append(session_cm_id)
        else:
            if len(person_data) >= 20:
                continue
            person_data[cm_id] = PersonSearchItem(
                cm_id=cm_id,
                first_name=getattr(person, "first_name", ""),
                last_name=getattr(person, "last_name", ""),
                grade=getattr(person, "grade", None),
                sessions=[session_cm_id] if session_cm_id else [],
            )

    items = list(person_data.values())
    for item in items:
        item.sessions.sort()

    return PersonSearchResponse(items=items, total=len(items))


@router.get("/original-requests-with-parse-status", response_model=OriginalRequestsWithParseResponse)
async def list_original_requests_with_parse_status(
    year: int = Query(description="Year to filter by (required)", ge=2000, le=2100),
    session_cm_id: list[int] | None = Query(default=None, description="Filter by session CM ID(s)"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum results"),
    user: AuthUser = Depends(require_admin),
) -> OriginalRequestsWithParseResponse:
    """List original_bunk_requests with their parse status flags.

    For each original request, indicates whether debug and/or production
    parse results exist. Use this to show the debug UI with status indicators.

    session_cm_id can be passed multiple times to filter by multiple sessions,
    e.g., ?session_cm_id=200&session_cm_id=201 to include main + AG sessions.
    """
    # Create loader with specified year
    loader = OriginalRequestsLoader(pb, year)
    loader.load_persons_cache()

    records = loader.load_by_filter(
        session_cm_id=session_cm_id,
        source_field=source_field,
        limit=limit,
    )

    debug_repo = get_debug_parse_repository()

    # Use batch status check for efficiency (2 queries instead of N*2)
    record_ids = [r.id for r in records]
    status_map = debug_repo.check_parse_status_batch(record_ids)

    items = []
    for record in records:
        first = record.preferred_name or record.first_name
        requester_name = f"{first} {record.last_name}".strip()

        # Get status from batch result
        has_debug, has_production = status_map.get(record.id, (False, False))

        items.append(
            OriginalRequestWithStatus(
                id=record.id,
                requester_name=requester_name,
                requester_cm_id=record.requester_cm_id,
                source_field=record.field,
                original_text=record.content,
                year=record.year,
                has_debug_result=has_debug,
                has_production_result=has_production,
            )
        )

    return OriginalRequestsWithParseResponse(items=items, total=len(items))


# AI-processed fields only (excludes socialize_with which is dropdown-based)
AI_PARSED_FIELDS = {"bunk_request_form", "staff_not_bunk_with", "bunking_notes", "internal_notes"}


@router.get("/original-requests-grouped", response_model=GroupedRequestsResponse)
async def list_original_requests_grouped(
    year: int = Query(description="Year to filter by (required)", ge=2000, le=2100),
    session_cm_id: list[int] | None = Query(default=None, description="Filter by session CM ID(s)"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=5000, ge=1, description="Maximum campers to return"),
    user: AuthUser = Depends(require_admin),
) -> GroupedRequestsResponse:
    """List original requests grouped by camper.

    Excludes socialize_with (not AI parsed).
    Each camper group contains all their AI-parseable fields.
    """
    # Create loader with specified year
    loader = OriginalRequestsLoader(pb, year)
    loader.load_persons_cache()

    # Load records - if source_field filter is specified, only load that field
    # Otherwise, load ALL records (no field filter) and filter AI fields in Python
    # Pass limit=0 to get all records via get_full_list, then apply limit after grouping
    records = loader.load_by_filter(
        session_cm_id=session_cm_id,
        source_field=source_field,
        limit=0,  # Fetch all, apply camper limit after grouping
    )

    # Filter out socialize_with (not AI parsed)
    ai_records = [r for r in records if r.field in AI_PARSED_FIELDS]

    debug_repo = get_debug_parse_repository()

    # Use batch status check for efficiency
    record_ids = [r.id for r in ai_records]
    status_map = debug_repo.check_parse_status_batch(record_ids)

    # Group by camper (requester_cm_id) - build CamperGroupedRequests directly
    camper_groups: dict[int, CamperGroupedRequests] = {}
    for record in ai_records:
        cm_id = record.requester_cm_id
        if cm_id not in camper_groups:
            first = record.preferred_name or record.first_name
            camper_groups[cm_id] = CamperGroupedRequests(
                requester_cm_id=cm_id,
                requester_name=f"{first} {record.last_name}".strip(),
                fields=[],
            )

        has_debug, has_production = status_map.get(record.id, (False, False))
        camper_groups[cm_id].fields.append(
            FieldParseResult(
                original_request_id=record.id,
                source_field=record.field,
                original_text=record.content,
                has_debug_result=has_debug,
                has_production_result=has_production,
            )
        )

    # Apply camper limit
    items = list(camper_groups.values())[:limit]

    return GroupedRequestsResponse(items=items, total=len(items))


@router.post("/parse-results-batch", response_model=list[ParseResultWithSource])
async def get_parse_results_batch(
    original_request_ids: list[str],
    user: AuthUser = Depends(require_admin),
) -> list[ParseResultWithSource]:
    """Get Phase 1 parse results for multiple original requests in one call.

    This is optimized to use only 3 database queries regardless of how many
    IDs are requested, making it much faster than calling the single endpoint
    multiple times.

    Args:
        original_request_ids: List of original_bunk_requests record IDs

    Returns:
        List of ParseResultWithSource in the same order as input IDs
    """
    if not original_request_ids:
        return []

    debug_repo = get_debug_parse_repository()
    results_map = debug_repo.get_results_batch(original_request_ids)

    # Convert to response models, preserving input order
    responses: list[ParseResultWithSource] = []

    for rid in original_request_ids:
        data = results_map.get(rid, {})

        # Convert parsed_intents to proper model
        parsed_intents = [_build_parsed_intent(intent) for intent in data.get("parsed_intents", [])]

        responses.append(
            ParseResultWithSource(
                source=data.get("source", "none"),
                id=data.get("id"),
                parsed_intents=parsed_intents,
                is_valid=data.get("is_valid", True),
                error_message=data.get("error_message"),
                token_count=data.get("token_count"),
                processing_time_ms=data.get("processing_time_ms"),
                prompt_version=data.get("prompt_version"),
                created=_parse_pb_datetime(data.get("created")),
                original_request_id=data.get("original_request_id", rid),
                requester_name=data.get("requester_name", ""),
                requester_cm_id=data.get("requester_cm_id"),
                source_field=data.get("source_field", ""),
                original_text=data.get("original_text", ""),
            )
        )

    return responses


@router.post("/parse-results-batch-dual", response_model=list[DualSourceParseResult])
async def get_parse_results_batch_dual(
    original_request_ids: list[str],
    user: AuthUser = Depends(require_admin),
) -> list[DualSourceParseResult]:
    """Get BOTH debug and production parse results for multiple original requests.

    Unlike /parse-results-batch, this returns both sources separately,
    allowing the frontend to toggle between viewing debug and production results.

    Args:
        original_request_ids: List of original_bunk_requests record IDs

    Returns:
        List of DualSourceParseResult in the same order as input IDs
    """
    if not original_request_ids:
        return []

    debug_repo = get_debug_parse_repository()
    results_map = debug_repo.get_results_batch_dual(original_request_ids)

    # Convert to response models, preserving input order
    responses: list[DualSourceParseResult] = []

    for rid in original_request_ids:
        data = results_map.get(rid, {})

        # Convert debug_result if present
        debug_result_data: ParseResultData | None = None
        if data.get("debug_result"):
            dr = data["debug_result"]
            # Convert parsed_intents
            debug_intents = [_build_parsed_intent(intent) for intent in dr.get("parsed_intents", [])]

            debug_result_data = ParseResultData(
                id=dr.get("id"),
                parsed_intents=debug_intents,
                is_valid=dr.get("is_valid", True),
                error_message=dr.get("error_message"),
                token_count=dr.get("token_count"),
                processing_time_ms=dr.get("processing_time_ms"),
                prompt_version=dr.get("prompt_version"),
                created=_parse_pb_datetime(dr.get("created")),
            )

        # Convert production_result if present
        prod_result_data: ParseResultData | None = None
        if data.get("production_result"):
            pr = data["production_result"]
            # Convert parsed_intents
            prod_intents = [_build_parsed_intent(intent) for intent in pr.get("parsed_intents", [])]

            prod_result_data = ParseResultData(
                parsed_intents=prod_intents,
                is_valid=pr.get("is_valid", True),
            )

        responses.append(
            DualSourceParseResult(
                original_request_id=data.get("original_request_id", rid),
                requester_name=data.get("requester_name"),
                requester_cm_id=data.get("requester_cm_id"),
                source_field=data.get("source_field"),
                original_text=data.get("original_text"),
                has_debug=data.get("has_debug", False),
                has_production=data.get("has_production", False),
                debug_result=debug_result_data,
                production_result=prod_result_data,
            )
        )

    return responses


@router.get("/parse-result/{original_request_id}", response_model=ParseResultWithSource)
async def get_parse_result_with_fallback(
    original_request_id: str, user: AuthUser = Depends(require_admin)
) -> ParseResultWithSource:
    """Get Phase 1 parse result for an original request with fallback.

    Priority:
    1. debug_parse_results (if exists) - returns source="debug"
    2. bunk_requests via bunk_request_sources (fallback) - returns source="production"
    3. Neither exists - returns source="none" with empty parsed_intents

    IMPORTANT: Original request data (requester_name, source_field, original_text)
    is ALWAYS loaded from original_bunk_requests, regardless of whether debug
    or production results exist.
    """
    # 1. ALWAYS load original request first to get base data
    loader = get_original_requests_loader()
    originals = loader.load_by_ids([original_request_id])
    if not originals:
        raise HTTPException(status_code=404, detail="Original request not found")

    orig = originals[0]

    # Build base response from original request (always populated)
    first = orig.preferred_name or orig.first_name
    requester_name = f"{first} {orig.last_name}".strip()

    # Base data from original request (always populated)
    base_original_request_id = original_request_id
    base_requester_name = requester_name
    base_requester_cm_id = orig.requester_cm_id
    base_source_field = orig.field
    base_original_text = orig.content

    debug_repo = get_debug_parse_repository()

    # 2. Check for debug result
    debug_result = debug_repo.get_by_original_request(original_request_id)
    if debug_result:
        # Convert parsed_intents to proper model
        parsed_intents = [_build_parsed_intent(intent) for intent in debug_result.get("parsed_intents", [])]

        return ParseResultWithSource(
            source="debug",
            id=debug_result.get("id"),
            parsed_intents=parsed_intents,
            is_valid=debug_result.get("is_valid", True),
            error_message=debug_result.get("error_message"),
            token_count=debug_result.get("token_count"),
            processing_time_ms=debug_result.get("processing_time_ms"),
            prompt_version=debug_result.get("prompt_version"),
            created=_parse_pb_datetime(debug_result.get("created")),
            original_request_id=base_original_request_id,
            requester_name=base_requester_name,
            requester_cm_id=base_requester_cm_id,
            source_field=base_source_field,
            original_text=base_original_text,
        )

    # 3. Fallback to production data
    production_result = debug_repo.get_production_fallback(original_request_id)
    if production_result:
        # Convert parsed_intents to proper model
        parsed_intents = [_build_parsed_intent(intent) for intent in production_result.get("parsed_intents", [])]

        return ParseResultWithSource(
            source="production",
            parsed_intents=parsed_intents,
            is_valid=production_result.get("is_valid", True),
            original_request_id=base_original_request_id,
            requester_name=base_requester_name,
            requester_cm_id=base_requester_cm_id,
            source_field=base_source_field,
            original_text=base_original_text,
        )

    # 4. Neither debug nor production exists - still include original data
    return ParseResultWithSource(
        source="none",
        parsed_intents=[],
        original_request_id=base_original_request_id,
        requester_name=base_requester_name,
        requester_cm_id=base_requester_cm_id,
        source_field=base_source_field,
        original_text=base_original_text,
    )


# ============================================================================
# Prompt Editor Endpoints
# ============================================================================


def _safe_prompt_path(name: str) -> Path:
    """Validate prompt name and return a safe file path via directory listing.

    Prevents path traversal by validating the name pattern and then locating
    the file through a directory glob rather than constructing a path from
    user input.
    """
    if not VALID_PROMPT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid prompt name. Only alphanumeric characters and underscores allowed.",
        )
    # Look up by listing the directory — avoids constructing a path from user input
    if PROMPTS_DIR.exists():
        for candidate in PROMPTS_DIR.glob("*.txt"):
            if candidate.stem == name:
                return candidate
    raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")


def _get_file_modified_at(path: Path) -> datetime | None:
    """Get file modification time as datetime."""
    try:
        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=UTC)
    except OSError:
        return None


@router.get("/prompts", response_model=PromptListResponse)
async def list_prompts(user: AuthUser = Depends(require_admin)) -> PromptListResponse:
    """List available prompt files.

    Returns all .txt files in the config/prompts directory.
    """
    if not PROMPTS_DIR.exists():
        return PromptListResponse(prompts=[])

    prompts = sorted(
        [
            PromptListItem(
                name=file_path.stem,
                filename=file_path.name,
                modified_at=_get_file_modified_at(file_path),
            )
            for file_path in PROMPTS_DIR.glob("*.txt")
        ],
        key=lambda p: p.name,
    )
    return PromptListResponse(prompts=prompts)


@router.get("/prompts/{name}", response_model=PromptContentResponse)
async def get_prompt(name: str, user: AuthUser = Depends(require_admin)) -> PromptContentResponse:
    """Get the content of a specific prompt file.

    Args:
        name: Prompt name (without .txt extension)
    """
    file_path = _safe_prompt_path(name)  # raises 404 if not found

    content = file_path.read_text(encoding="utf-8")
    modified_at = _get_file_modified_at(file_path)

    return PromptContentResponse(
        name=name,
        content=content,
        modified_at=modified_at,
    )


@router.put("/prompts/{name}", response_model=PromptUpdateResponse)
async def update_prompt(
    name: str, request: PromptUpdateRequest, user: AuthUser = Depends(require_admin)
) -> PromptUpdateResponse:
    """Update a prompt file's content.

    Args:
        name: Prompt name (without .txt extension)
        request: Request body with new content
    """
    file_path = _safe_prompt_path(name)  # raises 404 if not found

    # Write the new content
    file_path.write_text(request.content, encoding="utf-8")

    # Clear the prompt cache so the new content is used
    clear_prompt_cache()

    return PromptUpdateResponse(name=name, success=True)


# =============================================================================
# Production Requests Endpoint (3-Column Layout)
# =============================================================================


@router.get("/production-requests/{camper_cm_id}", response_model=ProductionRequestsResponse)
async def get_production_requests(
    camper_cm_id: int,
    year: int = Query(description="Year to filter by (required)", ge=2000, le=2100),
    session_cm_id: int | None = Query(default=None, description="Filter by session CM ID"),
    user: AuthUser = Depends(require_admin),
) -> ProductionRequestsResponse:
    """Get all production bunk_requests for a camper, grouped by source_field.

    This endpoint is used by the 3-column debug layout to show production
    data in the right column, allowing side-by-side comparison with debug
    parse results in the center column.

    Args:
        camper_cm_id: CampMinder ID of the camper
        year: Year to filter by (required)
        session_cm_id: Optional session filter

    Returns:
        Production requests grouped by source_field (bunk_request_form, staff_not_bunk_with, etc.)
    """
    bunk_repo = get_bunk_requests_repository()

    # Fetch all bunk_requests for this camper
    records = bunk_repo.find_by_requester(
        camper_cm_id,
        year=year,
        session_cm_id=session_cm_id,
    )

    # Group by source_field
    groups: dict[str, list[ProductionRequestItem]] = defaultdict(list)

    for record in records:
        source_field = record.get("source_field") or "unknown"
        groups[source_field].append(
            ProductionRequestItem(
                id=record.get("id", ""),
                requestee_id=record.get("requestee_id"),
                requested_person_name=record.get("requested_person_name"),
                request_type=record.get("request_type", ""),
                confidence_score=record.get("confidence_score"),
                confidence_level=record.get("confidence_level"),
                keywords_found=record.get("keywords_found", []),
                parse_notes=record.get("parse_notes"),
                ai_p1_reasoning=record.get("ai_p1_reasoning"),
                status=record.get("status"),
                is_active=record.get("is_active"),
                original_text=record.get("original_text"),
            )
        )

    return ProductionRequestsResponse(
        groups=dict(groups),
        total=len(records),
    )


# =============================================================================
# Pipeline Debug Endpoints — Runs, Traces, Summaries
# =============================================================================


def _parse_pb_datetime(value: Any) -> datetime | None:
    """Parse a PocketBase datetime string to a datetime object."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError, TypeError:
        return None


def _pb_record_to_run_item(record: Any) -> PipelineRunItem:
    """Convert a PB debug_pipeline_runs record to a PipelineRunItem."""
    return PipelineRunItem(
        id=getattr(record, "id", ""),
        run_id=getattr(record, "run_id", ""),
        year=getattr(record, "year", 0),
        session=getattr(record, "session", ""),
        source_fields=getattr(record, "source_fields", []) or [],
        limit_param=getattr(record, "limit_param", 0),
        force=getattr(record, "force", False),
        trace_count=getattr(record, "trace_count", 0),
        status_breakdown=getattr(record, "status_breakdown", {}) or {},
        pinned=getattr(record, "pinned", False),
        created=_parse_pb_datetime(getattr(record, "created", None)),
    )


def _pb_record_to_summary_item(record: Any) -> PipelineSummaryItem:
    """Convert a PB debug_pipeline_summary record to a PipelineSummaryItem."""
    return PipelineSummaryItem(
        id=getattr(record, "id", "") or "",
        run_id=getattr(record, "run_id", "") or "",
        trace_id=getattr(record, "trace", "") or "",
        original_request_id=getattr(record, "original_request", "") or "",
        bunk_request_id=getattr(record, "bunk_request", None) or None,
        requester_cm_id=getattr(record, "requester_cm_id", 0) or 0,
        requester_name=getattr(record, "requester_name", "") or "",
        target_name=getattr(record, "target_name", "") or "",
        source_field=getattr(record, "source_field", "") or "",
        session_cm_id=getattr(record, "session_cm_id", 0) or 0,
        request_type=getattr(record, "request_type", "") or "",
        final_status=getattr(record, "final_status", "") or "",
        final_confidence=getattr(record, "final_confidence", 0.0) or 0.0,
        resolution_method=getattr(record, "resolution_method", "") or "",
        phase3_triggered=getattr(record, "phase3_triggered", None) is True,
        ai_reasoning_summary=getattr(record, "ai_reasoning_summary", "") or "",
        pre_p1_action=getattr(record, "pre_p1_action", "") or "",
        year=getattr(record, "year", 0) or 0,
        disposition_reason=getattr(record, "disposition_reason", "") or "",
        is_reciprocal=getattr(record, "is_reciprocal", None) is True,
    )


def _pb_record_to_trace_item(record: Any) -> PipelineTraceItem:
    """Convert a PB debug_pipeline_traces record to a PipelineTraceItem."""
    return PipelineTraceItem(
        id=getattr(record, "id", ""),
        run_id=getattr(record, "run_id", ""),
        original_request_id=getattr(record, "original_request", ""),
        requester_cm_id=getattr(record, "requester_cm_id", 0),
        year=getattr(record, "year", 0),
        session_cm_id=getattr(record, "session_cm_id", 0),
        source_field=getattr(record, "source_field", ""),
        trace_data=getattr(record, "trace_data", {}) or {},
        pinned=getattr(record, "pinned", False),
        created=_parse_pb_datetime(getattr(record, "created", None)),
    )


# Allowlists for PB filter injection prevention
VALID_RUN_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
VALID_FINAL_STATUSES = {"RESOLVED", "PENDING", "DECLINED"}
VALID_RESOLUTION_METHODS = {
    # Resolution pipeline strategies
    "exact_match",
    "fuzzy_match",
    "phonetic_match",
    "school_disambiguation",
    # Phase 2 fast paths
    "prior_bunkmate_exact",
    "prior_bunkmate_first_name",
    "ai_id_validated",
    "ai_id_validated_normalized",
    "ai_id_partial_match",
    "ai_candidate_disambiguated",
    "staff_filtered",
    # Phase 3
    "ai_disambiguation",
    # Social graph
    "social_graph_auto",
    # Direct parse / special
    "age_preference",
    "placeholder",
    # Edge cases (can appear when resolution fails or is skipped)
    "age_preference_missing",
    "no_target_name",
    "no_resolution_needed",
    "no_resolution",
    "resolution_incomplete",
    "invalid_parse",
    "unresolved",
}
VALID_SOURCE_FIELDS = {
    "bunk_request_form",
    "staff_not_bunk_with",
    "bunking_notes",
    "internal_notes",
    "socialize_with",
}
VALID_PRE_P1_ACTIONS = {
    "parsed",
    "skipped_no_preference",
    "skipped_no_session",
    "skipped_already_processed",
    "skipped_staff",
    "socialize_direct_map",
}
VALID_CASCADE_PHASES = set(PHASE_ORDER)


def _validate_run_id(run_id: str) -> None:
    """Validate run_id matches expected UUID hex format to prevent PB filter injection."""
    if not VALID_RUN_ID_PATTERN.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id format")


def _validate_allowlist(value: str, allowlist: set[str], field_name: str) -> None:
    """Validate a string value against an allowlist to prevent PB filter injection."""
    if value not in allowlist:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name} value: '{value}'",
        )


@router.get("/pipeline-runs", response_model=PipelineRunsResponse)
def list_pipeline_runs(
    user: AuthUser = Depends(require_admin),
) -> PipelineRunsResponse:
    """List all pipeline debug runs, newest first."""
    records = pb.collection(DEBUG_PIPELINE_RUNS).get_full_list(query_params={"sort": "-created"})
    items = [_pb_record_to_run_item(r) for r in records]
    return PipelineRunsResponse(items=items, total=len(items))


@router.post("/pipeline-runs/{run_id}/pin", response_model=PinToggleResponse)
def toggle_pipeline_run_pin(
    run_id: str,
    user: AuthUser = Depends(require_admin),
) -> PinToggleResponse:
    """Toggle the pinned status of a pipeline run."""
    _validate_run_id(run_id)
    # Find the run record by run_id
    records = pb.collection(DEBUG_PIPELINE_RUNS).get_full_list(query_params={"filter": f'run_id = "{run_id}"'})
    if not records:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    record = records[0]
    current_pinned = getattr(record, "pinned", False)
    new_pinned = not current_pinned

    # Update the record
    pb.collection(DEBUG_PIPELINE_RUNS).update(record.id, {"pinned": new_pinned})

    return PinToggleResponse(run_id=run_id, pinned=new_pinned)


@router.get("/pipeline-runs/{run_id}/summary", response_model=PipelineSummaryResponse)
def get_pipeline_run_summary(
    run_id: str,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=500),
    final_status: str | None = Query(default=None),
    resolution_method: str | None = Query(default=None),
    source_field: str | None = Query(default=None),
    phase3_triggered: bool | None = Query(default=None),
    pre_p1_action: str | None = Query(default=None),
    session_cm_id: int | None = Query(default=None, ge=1),
    min_confidence: float | None = Query(default=None, ge=0.0, le=1.0),
    max_confidence: float | None = Query(default=None, ge=0.0, le=1.0),
    search: str | None = Query(default=None, max_length=100),
    fetch_all: bool = Query(default=False),
    user: AuthUser = Depends(require_admin),
) -> PipelineSummaryResponse:
    """Get summary rows for a run with PB-native filtering/pagination.

    When ``fetch_all=true``, returns every row for the run in a single
    response using PocketBase's ``get_full_list``, bypassing ``page`` and
    ``per_page``. This powers the client-side filter/sort/virtualized-scroll
    batch list UI (see PipelineBatchList.tsx). Server-side sort is fixed
    (``-final_confidence``) since the client re-sorts in memory anyway.
    """
    _validate_run_id(run_id)
    filter_parts = [f'run_id = "{run_id}"']

    if final_status:
        _validate_allowlist(final_status, VALID_FINAL_STATUSES, "final_status")
        filter_parts.append(f'final_status = "{final_status}"')
    if resolution_method:
        _validate_allowlist(resolution_method, VALID_RESOLUTION_METHODS, "resolution_method")
        filter_parts.append(f'resolution_method = "{resolution_method}"')
    if source_field:
        _validate_allowlist(source_field, VALID_SOURCE_FIELDS, "source_field")
        filter_parts.append(f'source_field = "{source_field}"')
    if phase3_triggered is not None:
        filter_parts.append(f"phase3_triggered = {str(phase3_triggered).lower()}")
    if pre_p1_action:
        _validate_allowlist(pre_p1_action, VALID_PRE_P1_ACTIONS, "pre_p1_action")
        filter_parts.append(f'pre_p1_action = "{pre_p1_action}"')
    if session_cm_id is not None:
        filter_parts.append(f"session_cm_id = {session_cm_id}")
    if min_confidence is not None:
        filter_parts.append(f"final_confidence >= {min_confidence}")
    if max_confidence is not None:
        filter_parts.append(f"final_confidence <= {max_confidence}")
    if search:
        # Sanitize: strip quotes to prevent PB filter injection
        safe_search = search.replace('"', "").replace("'", "").strip()
        if safe_search:
            filter_parts.append(f'(requester_name ~ "{safe_search}" || target_name ~ "{safe_search}")')

    filter_str = " && ".join(filter_parts)

    if fetch_all:
        records = pb.collection(DEBUG_PIPELINE_SUMMARY).get_full_list(
            query_params={"filter": filter_str, "sort": "-final_confidence"},
        )
        items = [_pb_record_to_summary_item(r) for r in records]
        return PipelineSummaryResponse(
            items=items,
            total=len(items),
            page=1,
            per_page=len(items) or 1,
        )

    result = pb.collection(DEBUG_PIPELINE_SUMMARY).get_list(
        page=page,
        per_page=per_page,
        query_params={"filter": filter_str, "sort": "-final_confidence"},
    )

    items = [_pb_record_to_summary_item(r) for r in result.items]
    return PipelineSummaryResponse(
        items=items,
        total=result.total_items,
        page=result.page,
        per_page=result.per_page,
    )


@router.get("/pipeline-traces/by-camper/{cm_id}", response_model=PipelineTracesByCamperResponse)
def get_traces_by_camper(
    cm_id: int,
    user: AuthUser = Depends(require_admin),
) -> PipelineTracesByCamperResponse:
    """Get all traces for a camper across all runs."""
    records = pb.collection(DEBUG_PIPELINE_TRACES).get_full_list(
        query_params={
            "filter": f"requester_cm_id = {cm_id}",
            "sort": "-created",
        }
    )
    items = [_pb_record_to_trace_item(r) for r in records]
    return PipelineTracesByCamperResponse(items=items, total=len(items))


@router.get("/pipeline-traces/{trace_id}", response_model=PipelineTraceResponse)
def get_pipeline_trace(
    trace_id: str,
    user: AuthUser = Depends(require_admin),
) -> PipelineTraceResponse:
    """Get full trace JSON for drill-down."""
    try:
        record = pb.collection(DEBUG_PIPELINE_TRACES).get_one(trace_id)
    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail=f"Trace '{trace_id}' not found") from e
        raise pb_error_to_http(e) from e

    return PipelineTraceResponse(trace=_pb_record_to_trace_item(record))


# =============================================================================
# Pipeline Debug Endpoints — On-Demand Phase Execution
# =============================================================================


def _create_phase_runner(
    year: int = 2025,
    session_cm_ids: list[int] | None = None,
    trace_collector: TraceCollector | None = None,
) -> Any:
    """Create a PhaseRunner backed by a real orchestrator.

    This function is defined at module level so it can be patched in tests.
    Initializes a DataAccessContext and RequestOrchestrator, then wraps
    them in a PhaseRunner for on-demand phase execution.

    Args:
        year: Camp year for data context initialization.
        session_cm_ids: Session CM IDs to scope the orchestrator to.
        trace_collector: Optional TraceCollector for debug instrumentation.

    Returns:
        PhaseRunner instance (or mock in tests).
    """
    from bunking.sync.bunk_request_processor.data.data_access_context import DataAccessContext
    from bunking.sync.bunk_request_processor.debug.phase_runner import PhaseRunner
    from bunking.sync.bunk_request_processor.orchestrator import RequestOrchestrator

    data_context = DataAccessContext(year=year)
    data_context.initialize_sync()
    orchestrator = RequestOrchestrator(
        year=year,
        session_cm_ids=session_cm_ids or [],
        data_context=data_context,
        trace_collector=trace_collector,
    )
    return PhaseRunner(orchestrator)


def _load_trace_record(trace_id: str) -> Any:
    """Load a full PB trace record by ID.

    Args:
        trace_id: PocketBase record ID for the trace.

    Returns:
        The PocketBase record object.

    Raises:
        HTTPException: If trace not found.
    """
    try:
        return pb.collection(DEBUG_PIPELINE_TRACES).get_one(trace_id)
    except ClientResponseError as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail=f"Trace '{trace_id}' not found") from e
        raise pb_error_to_http(e) from e


def _load_trace_data(trace_id: str) -> dict[str, Any]:
    """Load trace_data JSON from a PB trace record.

    Args:
        trace_id: PocketBase record ID for the trace.

    Returns:
        The trace_data dict.

    Raises:
        HTTPException: If trace not found.
    """
    record = _load_trace_record(trace_id)
    return getattr(record, "trace_data", {}) or {}


@router.post("/run-phase1", response_model=PhaseRunResponse)
async def run_phase1(
    body: RunPhase1Request,
    user: AuthUser = Depends(require_admin),
) -> PhaseRunResponse:
    """Run Phase 1 AI parsing on selected original_bunk_requests.

    Delegates to Phase1DebugService.parse_selected_records() which handles
    loading, parsing, and caching. Always dry-run — Phase 1 never writes
    bunk_requests to production.
    """
    try:
        debug_service = await get_phase1_debug_service()
        results = await debug_service.parse_selected_records(body.original_request_ids)

        return PhaseRunResponse(
            success=True,
            phase="phase1",
            dry_run=True,
            results={
                "parsed_count": len(results),
                "total_tokens": sum(r.get("token_count", 0) or 0 for r in results),
            },
        )
    except Exception:
        logger.exception("Phase 1 execution failed")
        return PhaseRunResponse(
            success=False,
            phase="phase1",
            dry_run=True,
            error="Phase execution failed",
        )


@router.post("/run-phase2", response_model=PhaseRunResponse)
async def run_phase2(
    body: RunPhase2Request,
    user: AuthUser = Depends(require_admin),
) -> PhaseRunResponse:
    """Run Phase 2 in isolation using prior Phase 1 output from a trace.

    Always dry-run — single phase re-runs never write to production.
    """
    # Load full trace record for year/session context
    trace_record = _load_trace_record(body.trace_id)
    trace_data_dict = getattr(trace_record, "trace_data", {}) or {}
    year = getattr(trace_record, "year", 2025)
    session_cm_id = getattr(trace_record, "session_cm_id", None)
    session_cm_ids = [session_cm_id] if session_cm_id else []

    try:
        from bunking.sync.bunk_request_processor.debug.trace_models import TraceData

        trace_data = TraceData(**trace_data_dict)
        runner = _create_phase_runner(year=year, session_cm_ids=session_cm_ids)
        result = await runner.run_phase2(runner._reconstruct_parse_results_from_trace(trace_data))
        return PhaseRunResponse(
            success=True,
            phase="phase2",
            dry_run=True,
            results={"resolution_count": len(result)},
        )
    except Exception:
        logger.exception("Phase 2 execution failed")
        return PhaseRunResponse(
            success=False,
            phase="phase2",
            dry_run=True,
            error="Phase execution failed",
        )


@router.post("/run-phase3", response_model=PhaseRunResponse)
async def run_phase3(
    body: RunPhase3Request,
    user: AuthUser = Depends(require_admin),
) -> PhaseRunResponse:
    """Run Phase 3 in isolation using prior Phase 2 output from a trace.

    Always dry-run — single phase re-runs never write to production.
    """
    # Load full trace record for year/session context
    trace_record = _load_trace_record(body.trace_id)
    trace_data_dict = getattr(trace_record, "trace_data", {}) or {}
    year = getattr(trace_record, "year", 2025)
    session_cm_id = getattr(trace_record, "session_cm_id", None)
    session_cm_ids = [session_cm_id] if session_cm_id else []

    try:
        from bunking.sync.bunk_request_processor.debug.trace_models import TraceData

        trace_data = TraceData(**trace_data_dict)
        runner = _create_phase_runner(year=year, session_cm_ids=session_cm_ids)
        result = await runner.run_phase3(runner._reconstruct_ambiguous_from_trace(trace_data))
        return PhaseRunResponse(
            success=True,
            phase="phase3",
            dry_run=True,
            results={"disambiguation_count": len(result)},
        )
    except Exception:
        logger.exception("Phase 3 execution failed")
        return PhaseRunResponse(
            success=False,
            phase="phase3",
            dry_run=True,
            error="Phase execution failed",
        )


@router.post("/run-from-phase/{phase}", response_model=PhaseRunResponse)
async def run_from_phase(
    phase: str,
    body: RunFromPhaseRequest,
    user: AuthUser = Depends(require_admin),
) -> PhaseRunResponse:
    """Cascade from a specified phase through all remaining phases.

    Dry-run only; production writes are supported exclusively via
    ``/run-full-trace``. ``body.dry_run`` is accepted for API compatibility
    and forwarded to the runner, but this endpoint does not write to
    production regardless of its value.
    """
    if phase not in VALID_CASCADE_PHASES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid phase '{phase}'. Must be one of: {', '.join(sorted(VALID_CASCADE_PHASES))}",
        )

    trace_record = _load_trace_record(body.trace_id)
    trace_data_dict = getattr(trace_record, "trace_data", {}) or {}

    try:
        from uuid import uuid4

        from bunking.sync.bunk_request_processor.debug.trace_models import TraceData

        trace_data = TraceData(**trace_data_dict)

        # Create trace collector for this run
        trace_collector = TraceCollector(run_id=uuid4().hex)

        # Record pre-phase1 from existing trace data so the collector has context
        pre = trace_data.pre_phase1
        req_info = pre.requester_info
        trace_collector.record_pre_phase1(
            key=getattr(trace_record, "original_request", "") or body.trace_id,
            action=pre.action or "replayed",
            original_text=pre.original_text,
            requester_cm_id=req_info.cm_id or getattr(trace_record, "requester_cm_id", 0),
            year=getattr(trace_record, "year", 0) or body.year,
            session_cm_id=getattr(trace_record, "session_cm_id", 0),
            source_field=getattr(trace_record, "source_field", ""),
            cleaned_text=pre.cleaned_text,
            na_prefix_stripped=pre.na_prefix_stripped,
            staff_metadata=pre.staff_metadata,
            field_path=pre.field_path,
            socialize_mapped_value=pre.socialize_mapped_value,
            session_cm_ids=pre.session_cm_ids,
            requester_name=req_info.name,
            requester_grade=req_info.grade,
            skip_reason=pre.skip_reason,
        )

        runner = _create_phase_runner(
            year=body.year, session_cm_ids=body.session_cm_ids, trace_collector=trace_collector
        )
        result = await runner.run_from_phase(
            phase=phase,
            trace_data=trace_data,
            dry_run=body.dry_run,
            stop_at_phase=body.stop_at_phase,
        )

        # Flush traces and get trace_id
        trace_id = None
        if trace_collector.enabled:
            try:
                await trace_collector.flush(
                    pb,
                    run_metadata={
                        "year": body.year,
                        "session": str(body.session_cm_ids),
                        "source_fields": [],
                        "limit": 1,
                        "force": False,
                    },
                )
                traces = pb.collection(DEBUG_PIPELINE_TRACES).get_list(
                    1, 1, query_params={"filter": f'run_id = "{trace_collector.run_id}"'}
                )
                if traces.items:
                    trace_id = traces.items[0].id
            except Exception as e:
                logger.warning("Failed to flush debug traces: %s", e)

        return PhaseRunResponse(
            success=True,
            phase=phase,
            dry_run=body.dry_run,
            trace_id=trace_id,
            results=result,
        )
    except ValueError as e:
        # Invalid stop_at_phase ordering
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception:
        logger.exception("Phase execution failed for phase=%s", phase)
        return PhaseRunResponse(
            success=False,
            phase=phase,
            dry_run=body.dry_run,
            error="Phase execution failed",
        )


@router.post("/run-full-trace", response_model=PhaseRunResponse)
async def run_full_trace(
    body: RunFullTraceRequest,
    user: AuthUser = Depends(require_admin),
) -> PhaseRunResponse:
    """Run full pipeline for selected records with tracing enabled.

    Loads original_bunk_requests by ID, converts to ParseRequest objects,
    then runs the full Phase 1 -> 2 -> 3 pipeline via PhaseRunner.

    Supports dry_run (default True). When dry_run=False, writes to production.
    """
    try:
        from uuid import uuid4

        # Create trace collector for this run
        trace_collector = TraceCollector(run_id=uuid4().hex)

        runner = _create_phase_runner(
            year=body.year, session_cm_ids=body.session_cm_ids, trace_collector=trace_collector
        )

        # Load original requests and convert to ParseRequest objects
        loader = OriginalRequestsLoader(pb, body.year, session_cm_ids=body.session_cm_ids)
        loader.load_persons_cache()
        original_records = loader.load_by_ids(body.original_request_ids)

        if not original_records:
            return PhaseRunResponse(
                success=True,
                phase="full",
                dry_run=body.dry_run,
                results={"parsed_count": 0, "message": "No original requests found for the given IDs"},
            )

        # Convert OriginalRequest objects to ParseRequest format
        from bunking.sync.bunk_request_processor.core.models import ParseRequest

        parse_requests: list[ParseRequest] = []
        for orig in original_records:
            first = orig.preferred_name or orig.first_name
            requester_name = f"{first} {orig.last_name}".strip()
            session_cm_id = loader.get_session_for_person(orig.requester_cm_id) or 0
            session_name = f"Session {session_cm_id}" if session_cm_id else "Unknown"

            parse_req = ParseRequest(
                request_text=orig.content,
                field_name=orig.field,  # V2: field IS the source field name
                requester_name=requester_name,
                requester_cm_id=orig.requester_cm_id,
                requester_grade=str(orig.grade) if orig.grade else "",
                session_cm_id=session_cm_id,
                session_name=session_name,
                year=orig.year,
                row_data={"_original_request_ids": {orig.field: orig.id}},
            )
            parse_requests.append(parse_req)

        # Record pre-phase1 traces for each original record
        for orig, parse_req in zip(original_records, parse_requests, strict=True):
            trace_collector.record_pre_phase1(
                key=orig.id,
                action="parsed",
                original_text=orig.content,
                requester_cm_id=orig.requester_cm_id,
                year=orig.year,
                session_cm_id=parse_req.session_cm_id,
                source_field=parse_req.field_name,
                requester_name=parse_req.requester_name,
                requester_grade=parse_req.requester_grade,
            )

        result = await runner.run_full_trace(parse_requests, dry_run=body.dry_run, stop_at_phase=body.stop_at_phase)

        # Flush traces to PocketBase (only if collector is enabled)
        trace_id = None
        if trace_collector.enabled:
            try:
                await trace_collector.flush(
                    pb,
                    run_metadata={
                        "year": body.year,
                        "session": str(body.session_cm_ids),
                        "source_fields": [],
                        "limit": len(body.original_request_ids),
                        "force": False,
                    },
                )
                # Get the first trace record ID for navigation
                traces = pb.collection(DEBUG_PIPELINE_TRACES).get_list(
                    1, 1, query_params={"filter": f'run_id = "{trace_collector.run_id}"'}
                )
                if traces.items:
                    trace_id = traces.items[0].id
            except Exception as e:
                logger.warning("Failed to flush debug traces: %s", e)

        return PhaseRunResponse(
            success=True,
            phase="full",
            dry_run=body.dry_run,
            trace_id=trace_id,
            results=result,
        )
    except Exception:
        logger.exception("Full trace execution failed")
        return PhaseRunResponse(
            success=False,
            phase="full",
            dry_run=body.dry_run,
            error="Phase execution failed",
        )
