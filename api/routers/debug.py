"""Debug Router - Debug tools for Phase 1 AI parse analysis.

This router provides endpoints for analyzing and iterating on Phase 1
AI intent parsing without running the full 3-phase pipeline.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from bunking.sync.bunk_request_processor.data.repositories.debug_parse_repository import (
    DebugParseRepository,
)
from bunking.sync.bunk_request_processor.data.repositories.session_repository import (
    SessionRepository,
)
from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
    OriginalRequestsLoader,
)
from bunking.sync.bunk_request_processor.prompts.loader import (
    clear_cache as clear_prompt_cache,
)
from bunking.sync.bunk_request_processor.services.phase1_debug_service import (
    Phase1DebugService,
)

from ..dependencies import pb
from ..schemas.debug import (
    CamperGroupedRequests,
    ClearAnalysisResponse,
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
    ParseResultWithSource,
    Phase1OnlyRequest,
    Phase1OnlyResponse,
    PromptContentResponse,
    PromptListItem,
    PromptListResponse,
    PromptUpdateRequest,
    PromptUpdateResponse,
    SourceFieldType,
)
from ..settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/debug", tags=["debug"])

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
        parsed_intents = []
        for intent in item.get("parsed_intents", []):
            parsed_intents.append(
                ParsedIntent(
                    request_type=intent.get("request_type", "unknown"),
                    target_name=intent.get("target_name"),
                    keywords_found=intent.get("keywords_found", []),
                    parse_notes=intent.get("parse_notes", ""),
                    reasoning=intent.get("reasoning", ""),
                    list_position=intent.get("list_position", 0),
                    needs_clarification=intent.get("needs_clarification", False),
                    temporal_info=intent.get("temporal_info"),
                )
            )

        # Parse created timestamp
        created_str = item.get("created")
        created_dt = None
        if created_str:
            try:
                created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

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
                created=created_dt,
            )
        )

    return ParseAnalysisListResponse(items=response_items, total=total)


@router.get("/parse-analysis/{item_id}", response_model=ParseAnalysisDetailItem)
async def get_parse_analysis_detail(item_id: str) -> ParseAnalysisDetailItem:
    """Get detailed parse analysis result including raw AI response."""
    debug_repo = get_debug_parse_repository()
    item = debug_repo.get_by_id(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Parse analysis result not found")

    # Convert parsed_intents
    parsed_intents = []
    for intent in item.get("parsed_intents", []):
        parsed_intents.append(
            ParsedIntent(
                request_type=intent.get("request_type", "unknown"),
                target_name=intent.get("target_name"),
                keywords_found=intent.get("keywords_found", []),
                parse_notes=intent.get("parse_notes", ""),
                reasoning=intent.get("reasoning", ""),
                list_position=intent.get("list_position", 0),
                needs_clarification=intent.get("needs_clarification", False),
                temporal_info=intent.get("temporal_info"),
            )
        )

    # Parse created timestamp
    created_str = item.get("created")
    created_dt = None
    if created_str:
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

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
        created=created_dt,
        ai_raw_response=item.get("ai_raw_response"),
    )


@router.post("/parse-phase1-only", response_model=Phase1OnlyResponse)
async def parse_phase1_only(request: Phase1OnlyRequest) -> Phase1OnlyResponse:
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
        parsed_intents = []
        for intent in item.get("parsed_intents", []):
            parsed_intents.append(
                ParsedIntent(
                    request_type=intent.get("request_type", "unknown"),
                    target_name=intent.get("target_name"),
                    keywords_found=intent.get("keywords_found", []),
                    parse_notes=intent.get("parse_notes", ""),
                    reasoning=intent.get("reasoning", ""),
                    list_position=intent.get("list_position", 0),
                    needs_clarification=intent.get("needs_clarification", False),
                    temporal_info=intent.get("temporal_info"),
                )
            )

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
async def clear_single_parse_analysis(original_request_id: str) -> ClearAnalysisResponse:
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
        raise HTTPException(status_code=500, detail="Failed to clear parse analysis results")

    return ClearAnalysisResponse(deleted_count=deleted_count)


@router.get("/original-requests", response_model=OriginalRequestsListResponse)
async def list_original_requests(
    year: int = Query(description="Year to filter by (required)"),
    session_cm_id: int | None = Query(default=None, description="Filter by session CM ID"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=50, ge=1, le=500, description="Maximum results"),
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


@router.get("/original-requests-with-parse-status", response_model=OriginalRequestsWithParseResponse)
async def list_original_requests_with_parse_status(
    year: int = Query(description="Year to filter by (required)"),
    session_cm_id: list[int] | None = Query(default=None, description="Filter by session CM ID(s)"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum results"),
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
AI_PARSED_FIELDS = {"bunk_with", "not_bunk_with", "bunking_notes", "internal_notes"}


@router.get("/original-requests-grouped", response_model=GroupedRequestsResponse)
async def list_original_requests_grouped(
    year: int = Query(description="Year to filter by (required)"),
    session_cm_id: list[int] | None = Query(default=None, description="Filter by session CM ID(s)"),
    source_field: SourceFieldType | None = Query(default=None, description="Filter by source field"),
    limit: int = Query(default=50, ge=1, le=500, description="Maximum campers to return"),
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
    records = loader.load_by_filter(
        session_cm_id=session_cm_id,
        source_field=source_field,
        limit=limit * 4,  # Fetch more since we're grouping (up to 4 fields per camper)
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


@router.get("/parse-result/{original_request_id}", response_model=ParseResultWithSource)
async def get_parse_result_with_fallback(original_request_id: str) -> ParseResultWithSource:
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
        parsed_intents = []
        for intent in debug_result.get("parsed_intents", []):
            parsed_intents.append(
                ParsedIntent(
                    request_type=intent.get("request_type", "unknown"),
                    target_name=intent.get("target_name"),
                    keywords_found=intent.get("keywords_found", []),
                    parse_notes=intent.get("parse_notes", ""),
                    reasoning=intent.get("reasoning", ""),
                    list_position=intent.get("list_position", 0),
                    needs_clarification=intent.get("needs_clarification", False),
                    temporal_info=intent.get("temporal_info"),
                )
            )

        # Parse created timestamp
        created_str = debug_result.get("created")
        created_dt = None
        if created_str:
            try:
                created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass

        return ParseResultWithSource(
            source="debug",
            id=debug_result.get("id"),
            parsed_intents=parsed_intents,
            is_valid=debug_result.get("is_valid", True),
            error_message=debug_result.get("error_message"),
            token_count=debug_result.get("token_count"),
            processing_time_ms=debug_result.get("processing_time_ms"),
            prompt_version=debug_result.get("prompt_version"),
            created=created_dt,
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
        parsed_intents = []
        for intent in production_result.get("parsed_intents", []):
            parsed_intents.append(
                ParsedIntent(
                    request_type=intent.get("request_type", "unknown"),
                    target_name=intent.get("target_name"),
                    keywords_found=intent.get("keywords_found", []),
                    parse_notes=intent.get("parse_notes", ""),
                    reasoning=intent.get("reasoning", ""),
                    list_position=intent.get("list_position", 0),
                    needs_clarification=intent.get("needs_clarification", False),
                    temporal_info=intent.get("temporal_info"),
                )
            )

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


def _validate_prompt_name(name: str) -> None:
    """Validate prompt name to prevent path traversal attacks."""
    if not VALID_PROMPT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid prompt name. Only alphanumeric characters and underscores allowed.",
        )


def _get_file_modified_at(path: Path) -> datetime | None:
    """Get file modification time as datetime."""
    try:
        mtime = path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=UTC)
    except OSError:
        return None


@router.get("/prompts", response_model=PromptListResponse)
async def list_prompts() -> PromptListResponse:
    """List available prompt files.

    Returns all .txt files in the config/prompts directory.
    """
    if not PROMPTS_DIR.exists():
        return PromptListResponse(prompts=[])

    prompts = []
    for file_path in PROMPTS_DIR.glob("*.txt"):
        prompts.append(
            PromptListItem(
                name=file_path.stem,
                filename=file_path.name,
                modified_at=_get_file_modified_at(file_path),
            )
        )

    # Sort by name for consistent ordering
    prompts.sort(key=lambda p: p.name)
    return PromptListResponse(prompts=prompts)


@router.get("/prompts/{name}", response_model=PromptContentResponse)
async def get_prompt(name: str) -> PromptContentResponse:
    """Get the content of a specific prompt file.

    Args:
        name: Prompt name (without .txt extension)
    """
    _validate_prompt_name(name)

    file_path = PROMPTS_DIR / f"{name}.txt"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")

    content = file_path.read_text(encoding="utf-8")
    modified_at = _get_file_modified_at(file_path)

    return PromptContentResponse(
        name=name,
        content=content,
        modified_at=modified_at,
    )


@router.put("/prompts/{name}", response_model=PromptUpdateResponse)
async def update_prompt(name: str, request: PromptUpdateRequest) -> PromptUpdateResponse:
    """Update a prompt file's content.

    Args:
        name: Prompt name (without .txt extension)
        request: Request body with new content
    """
    _validate_prompt_name(name)

    file_path = PROMPTS_DIR / f"{name}.txt"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")

    # Write the new content
    file_path.write_text(request.content, encoding="utf-8")

    # Clear the prompt cache so the new content is used
    clear_prompt_cache()

    return PromptUpdateResponse(name=name, success=True)
