"""
Requests Router - Bunk request management endpoints.

This router provides endpoints for merging and splitting bunk_requests.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
    RequestRepository,
)
from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
    SourceLinkRepository,
)
from bunking.sync.bunk_request_processor.shared.constants import FIELD_TO_SOURCE_FIELD

from ..dependencies import pb

# Reverse mapping: source_field ("Share Bunk With") -> field enum ("bunk_with")
SOURCE_FIELD_TO_DB_FIELD = {v: k for k, v in FIELD_TO_SOURCE_FIELD.items()}

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["requests"])


# Dependency functions for repository injection (mockable in tests)
def get_request_repository() -> RequestRepository:
    """Get a RequestRepository instance."""
    return RequestRepository(pb)


def get_source_link_repository() -> SourceLinkRepository:
    """Get a SourceLinkRepository instance."""
    return SourceLinkRepository(pb)


def ensure_source_link_exists(
    bunk_request_id: str,
    requester_cm_id: int,
    source_field: str,
    year: int,
    session_id: int,
    source_link_repo: SourceLinkRepository,
    is_primary: bool = True,
    parse_notes: str | None = None,
) -> bool:
    """Ensure a source link exists for a bunk_request.

    If the request doesn't have any source links, find the corresponding
    original_bunk_request and create a link.

    Args:
        bunk_request_id: PocketBase ID of the bunk_request
        requester_cm_id: CampMinder ID of the requester
        source_field: Human-readable source field (e.g., "Share Bunk With")
        year: Year of the request
        session_id: Session ID
        source_link_repo: SourceLinkRepository instance
        is_primary: Whether this should be the primary source
        parse_notes: Optional AI parse notes from the bunk_request

    Returns:
        True if link exists or was created, False if couldn't find original
    """
    # Check if link already exists
    existing_sources = source_link_repo.get_sources_for_request(bunk_request_id)
    if existing_sources:
        return True

    # Map human-readable source_field to DB field enum
    db_field = SOURCE_FIELD_TO_DB_FIELD.get(source_field)
    if not db_field:
        logger.warning(f"Unknown source_field: {source_field}")
        return False

    try:
        # Find the person record by cm_id
        person_result = pb.collection("persons").get_list(
            query_params={
                "filter": f"cm_id = {requester_cm_id} && year = {year}",
                "perPage": 1,
            }
        )
        if not person_result.items:
            logger.warning(f"Person not found for cm_id={requester_cm_id}, year={year}")
            return False

        person_id = person_result.items[0].id

        # Find the original_bunk_request
        # Note: session field on original_bunk_requests may not be populated,
        # so we match by requester + field only
        orig_result = pb.collection("original_bunk_requests").get_list(
            query_params={
                "filter": f'requester = "{person_id}" && field = "{db_field}"',
                "perPage": 1,
            }
        )
        if not orig_result.items:
            logger.warning(f"Original request not found for person={person_id}, field={db_field}, session={session_id}")
            return False

        original_request_id = orig_result.items[0].id

        # Create the source link
        return source_link_repo.add_source_link(
            bunk_request_id=bunk_request_id,
            original_request_id=original_request_id,
            is_primary=is_primary,
            source_field=source_field,
            parse_notes=parse_notes,
        )

    except Exception as e:
        logger.warning(f"Error ensuring source link: {e}")
        return False


class MergeRequestsRequest(BaseModel):
    """Request body for merge endpoint."""

    request_ids: list[str]
    keep_target_from: str
    final_type: str

    @field_validator("request_ids")
    @classmethod
    def validate_request_ids(cls, v: list[str]) -> list[str]:
        """Validate that at least 2 request IDs are provided."""
        if len(v) < 2:
            raise ValueError("at least 2 request IDs required to merge")
        return v

    @field_validator("final_type")
    @classmethod
    def validate_final_type(cls, v: str) -> str:
        """Validate that final_type is a valid RequestType."""
        valid_types = [t.value for t in RequestType]
        if v not in valid_types:
            raise ValueError(f"invalid request type: {v}. Must be one of {valid_types}")
        return v


class MergeRequestsResponse(BaseModel):
    """Response body for merge endpoint."""

    merged_request_id: str
    merged_request_ids: list[str]  # Soft-deleted request IDs (previously deleted_request_ids)
    source_fields: list[str]
    confidence_score: float


class SplitSourceConfig(BaseModel):
    """Configuration for a single source to split off."""

    # This is the absorbed bunk_request ID (soft-deleted request that was merged)
    # Previously named original_request_id when using source links
    original_request_id: str  # Keep name for backwards compatibility with frontend
    new_type: str
    new_target_id: int | None = None

    @field_validator("new_type")
    @classmethod
    def validate_new_type(cls, v: str) -> str:
        """Validate that new_type is a valid RequestType."""
        valid_types = [t.value for t in RequestType]
        if v not in valid_types:
            raise ValueError(f"invalid request type: {v}. Must be one of {valid_types}")
        return v


class SplitRequestsRequest(BaseModel):
    """Request body for split endpoint."""

    request_id: str
    split_sources: list[SplitSourceConfig]

    @field_validator("split_sources")
    @classmethod
    def validate_split_sources(cls, v: list[SplitSourceConfig]) -> list[SplitSourceConfig]:
        """Validate that at least one source is provided."""
        if len(v) < 1:
            raise ValueError("at least one source required to split")
        return v


class SplitRequestsResponse(BaseModel):
    """Response body for split endpoint."""

    original_request_id: str
    restored_request_ids: list[str]  # Restored soft-deleted IDs (previously created_request_ids)
    updated_source_fields: list[str]


@router.post("/requests/merge", response_model=MergeRequestsResponse)
async def merge_requests(request: MergeRequestsRequest) -> MergeRequestsResponse:
    """Merge multiple bunk_requests into a single request.

    Combines source links, source_fields arrays, and metadata from all
    requests into the one specified by keep_target_from. Deletes the others.

    Args:
        request: Merge request with request_ids, keep_target_from, and final_type

    Returns:
        MergeRequestsResponse with the merged request ID and deleted IDs
    """
    # Validate keep_target_from is in request_ids
    if request.keep_target_from not in request.request_ids:
        raise HTTPException(
            status_code=422,
            detail=f"keep_target_from '{request.keep_target_from}' must be one of request_ids",
        )

    request_repo = get_request_repository()
    source_link_repo = get_source_link_repository()

    # Load all requests
    requests_to_merge = []
    for req_id in request.request_ids:
        req = request_repo.get_by_id(req_id)
        if req is None:
            raise HTTPException(
                status_code=404,
                detail=f"Request '{req_id}' not found",
            )
        requests_to_merge.append(req)

    # Validate all requests have same requester
    requester_ids = {r.requester_cm_id for r in requests_to_merge}
    if len(requester_ids) > 1:
        raise HTTPException(
            status_code=400,
            detail="All requests must have the same requester to merge",
        )

    # Validate all requests have same session
    session_ids = {r.session_cm_id for r in requests_to_merge}
    if len(session_ids) > 1:
        raise HTTPException(
            status_code=400,
            detail="All requests must be in the same session to merge",
        )

    # Find the request to keep
    keep_request = next(r for r in requests_to_merge if r.id == request.keep_target_from)
    requests_to_delete = [r for r in requests_to_merge if r.id != request.keep_target_from]

    # Type guard: IDs are guaranteed to exist for database records
    assert keep_request.id is not None, "Database record missing ID"
    for req in requests_to_delete:
        assert req.id is not None, "Database record missing ID"

    # Combine source_fields from all requests
    # Fall back to source_field (singular) if source_fields is empty
    combined_source_fields: list[str] = []
    for req in requests_to_merge:
        fields = getattr(req, "source_fields", None) or []
        if isinstance(fields, str):
            # Handle case where it's stored as JSON string
            import json

            try:
                fields = json.loads(fields)
            except json.JSONDecodeError:
                fields = [fields]

        # If source_fields is empty, fall back to source_field (singular)
        if not fields:
            single_field = getattr(req, "source_field", None)
            if single_field:
                fields = [single_field]

        for field in fields:
            if field and field not in combined_source_fields:
                combined_source_fields.append(field)

    # Get the highest confidence score
    max_confidence = max(r.confidence_score for r in requests_to_merge)

    # Combine metadata
    combined_metadata: dict[str, Any] = {}
    for req in requests_to_merge:
        metadata = req.metadata or {}
        for key, value in metadata.items():
            if key not in combined_metadata:
                combined_metadata[key] = value

    # Get IDs (guaranteed to exist for DB records, asserted above)
    kept_id: str = keep_request.id
    delete_ids: list[str] = [r.id for r in requests_to_delete]  # type: ignore[misc]

    # Track merge in metadata
    combined_metadata["merged_from"] = delete_ids
    combined_metadata["merge_timestamp"] = str(__import__("datetime").datetime.now().isoformat())

    # Ensure source links exist for all requests before merging
    # This handles legacy requests that were created before source_link tracking
    for req in requests_to_merge:
        assert req.id is not None
        # Get source field - from source_fields array or fall back to source_field
        req_source_fields = getattr(req, "source_fields", None) or []
        if isinstance(req_source_fields, str):
            import json

            try:
                req_source_fields = json.loads(req_source_fields)
            except json.JSONDecodeError:
                req_source_fields = [req_source_fields]

        if not req_source_fields:
            single_field = getattr(req, "source_field", None)
            if single_field:
                req_source_fields = [single_field]

        # Create source links for each source field
        # Include parse_notes from the original request for context in split modal
        req_parse_notes = getattr(req, "parse_notes", None)
        is_first = True
        for sf in req_source_fields:
            ensure_source_link_exists(
                bunk_request_id=req.id,
                requester_cm_id=req.requester_cm_id,
                source_field=sf,
                year=req.year,
                session_id=req.session_cm_id,
                source_link_repo=source_link_repo,
                is_primary=is_first,
                parse_notes=req_parse_notes,
            )
            is_first = False

    # Transfer source links from deleted requests to kept request
    for del_id in delete_ids:
        source_link_repo.transfer_all_sources(
            from_request_id=del_id,
            to_request_id=kept_id,
        )

    # Update the kept request
    request_repo.update_for_merge(
        record_id=kept_id,
        source_fields=combined_source_fields,
        confidence_score=max_confidence,
        metadata=combined_metadata,
    )

    # Soft-delete the merged requests (set merged_into instead of deleting)
    merged_ids: list[str] = []
    for merge_id in delete_ids:
        if request_repo.soft_delete_for_merge(merge_id, kept_id):
            merged_ids.append(merge_id)

    logger.info(f"Merged {len(merged_ids)} requests into {kept_id}. Source fields: {combined_source_fields}")

    return MergeRequestsResponse(
        merged_request_id=kept_id,
        merged_request_ids=merged_ids,
        source_fields=combined_source_fields,
        confidence_score=max_confidence,
    )


@router.post("/requests/split", response_model=SplitRequestsResponse)
async def split_requests(request: SplitRequestsRequest) -> SplitRequestsResponse:
    """Split a merged bunk_request into separate requests.

    For each source to split off:
    - First tries to restore a soft-deleted request (preserves all original data)
    - Falls back to creating a new request for legacy merges
    - Transfers source links appropriately
    - Updates original's source_fields to remove split sources

    Args:
        request: Split request with request_id and split_sources config

    Returns:
        SplitRequestsResponse with restored request IDs and updated source_fields
    """
    request_repo = get_request_repository()

    # Load the kept request (the one we're splitting from)
    kept_request = request_repo.get_by_id(request.request_id)
    if kept_request is None:
        raise HTTPException(
            status_code=404,
            detail=f"Request '{request.request_id}' not found",
        )

    assert kept_request.id is not None, "Database record missing ID"

    # Get all soft-deleted requests that were merged into this one
    merged_requests = request_repo.get_merged_requests(request.request_id)

    # Build a map of absorbed request ID -> absorbed request for efficient lookup
    merged_by_id: dict[str, BunkRequest] = {}
    for merged_req in merged_requests:
        if merged_req.id:
            merged_by_id[merged_req.id] = merged_req

    # Verify it's a merged request with absorbed requests
    if not merged_by_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot split a request that has no merged requests",
        )

    # Validate: cannot split off the kept request itself (it's the "primary")
    for split_config in request.split_sources:
        if split_config.original_request_id == request.request_id:
            raise HTTPException(
                status_code=400,
                detail="Cannot split off the primary request. Select absorbed requests to split off.",
            )
        if split_config.original_request_id not in merged_by_id:
            raise HTTPException(
                status_code=400,
                detail=f"Request '{split_config.original_request_id}' is not a merged request of '{request.request_id}'",
            )

    # Track restored requests and their source fields
    restored_request_ids: list[str] = []
    removed_source_fields: list[str] = []

    # Process each split source (now using absorbed request IDs directly)
    for split_config in request.split_sources:
        absorbed_request = merged_by_id.get(split_config.original_request_id)

        if absorbed_request is not None and absorbed_request.id is not None:
            # Get source_field from the absorbed request
            source_field = getattr(absorbed_request, "source_field", None)
            if source_field:
                removed_source_fields.append(source_field)

            # Restore the soft-deleted request (preserves all original AI data)
            if request_repo.restore_from_merge(absorbed_request.id):
                restored_request_ids.append(absorbed_request.id)
                logger.info(f"Restored absorbed request {absorbed_request.id}")
        else:
            logger.warning(f"Could not find absorbed request {split_config.original_request_id}")

    # Update kept request's source_fields (remove split sources)
    kept_source_fields = getattr(kept_request, "source_fields", None) or []
    if isinstance(kept_source_fields, str):
        import json

        try:
            kept_source_fields = json.loads(kept_source_fields)
        except json.JSONDecodeError:
            kept_source_fields = [kept_source_fields]

    updated_source_fields = [f for f in kept_source_fields if f not in removed_source_fields]
    request_repo.update_source_fields(
        record_id=kept_request.id,
        source_fields=updated_source_fields,
    )

    # Update merged_from metadata on kept request (remove split request IDs)
    metadata = getattr(kept_request, "metadata", {}) or {}
    merged_from = metadata.get("merged_from", [])
    if merged_from:
        updated_merged_from = [rid for rid in merged_from if rid not in restored_request_ids]
        request_repo.update_merged_from(kept_request.id, updated_merged_from)

    logger.info(
        f"Split {len(restored_request_ids)} sources from {request.request_id}. "
        f"Restored: {restored_request_ids}, Remaining source_fields: {updated_source_fields}"
    )

    return SplitRequestsResponse(
        original_request_id=request.request_id,
        restored_request_ids=restored_request_ids,
        updated_source_fields=updated_source_fields,
    )
