"""
Requests Router - Bunk request management endpoints.

This router provides endpoints for merging and splitting bunk_requests.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.data.repositories.request_repository import (
    RequestRepository,
)
from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
    SourceLinkRepository,
)

from ..dependencies import pb

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["requests"])


# Dependency functions for repository injection (mockable in tests)
def get_request_repository() -> RequestRepository:
    """Get a RequestRepository instance."""
    return RequestRepository(pb)


def get_source_link_repository() -> SourceLinkRepository:
    """Get a SourceLinkRepository instance."""
    return SourceLinkRepository(pb)


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
    deleted_request_ids: list[str]
    source_fields: list[str]
    confidence_score: float


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

    # Delete the merged requests
    deleted_ids: list[str] = []
    for del_id in delete_ids:
        if request_repo.delete(del_id):
            deleted_ids.append(del_id)

    logger.info(
        f"Merged {len(deleted_ids)} requests into {kept_id}. "
        f"Source fields: {combined_source_fields}"
    )

    return MergeRequestsResponse(
        merged_request_id=kept_id,
        deleted_request_ids=deleted_ids,
        source_fields=combined_source_fields,
        confidence_score=max_confidence,
    )
