"""Request Builder - Factory for creating BunkRequest objects

Handles the construction of BunkRequest objects from ParsedRequest
and ResolvedName data, with optional validation."""

from __future__ import annotations

from dataclasses import dataclass

from ..core.models import (
    BunkRequest,
    ParsedRequest,
    RequestStatus,
    RequestType,
    ResolvedName,
)
from ..validation.validation_pipeline import ValidationPipeline


@dataclass
class RequestBuilderOptions:
    """Options for building requests"""

    session_cm_id: int
    year: int
    csv_position: int
    default_priority: int = 3
    validate: bool = True


class RequestBuilder:
    """Factory for building BunkRequest objects"""

    def __init__(self, validation_pipeline: ValidationPipeline | None = None):
        """Initialize the request builder.

        Args:
            validation_pipeline: Optional validation pipeline for request validation
        """
        self.validation_pipeline = validation_pipeline

    def build(
        self, parsed_request: ParsedRequest, resolved_name: ResolvedName | None, options: RequestBuilderOptions
    ) -> BunkRequest:
        """Build a BunkRequest from parsed and resolved data.

        Args:
            parsed_request: The parsed request data
            resolved_name: The resolved name (None for unresolved/age preferences)
            options: Building options

        Returns:
            A constructed BunkRequest
        """
        # Get requester CM ID from metadata
        requester_cm_id = parsed_request.metadata.get("requester_cm_id")
        if not requester_cm_id:
            raise ValueError("ParsedRequest must have 'requester_cm_id' in metadata")

        # Determine status based on resolution and type
        if parsed_request.request_type == RequestType.AGE_PREFERENCE:
            status = RequestStatus.RESOLVED
            is_placeholder = False
            requested_cm_id = None
            confidence_score = parsed_request.confidence
        elif resolved_name:
            status = RequestStatus.RESOLVED
            is_placeholder = False
            requested_cm_id = resolved_name.matched_cm_id
            confidence_score = resolved_name.confidence
        else:
            status = RequestStatus.PENDING  # Unresolved names go to PENDING, not a new status
            is_placeholder = True
            requested_cm_id = None
            confidence_score = parsed_request.confidence

        # Build metadata by merging parsed and resolved metadata
        metadata = parsed_request.metadata.copy()

        # Add requester info
        if "full_name" in metadata:
            metadata["requester_full_name"] = metadata.pop("full_name")

        # Get priority from metadata or use default
        priority = metadata.get("priority", options.default_priority)

        # Add resolution info
        if resolved_name:
            if resolved_name.matched_person:
                metadata["resolved_full_name"] = resolved_name.matched_person.full_name
                metadata["session_cm_id"] = resolved_name.matched_person.session_cm_id
            metadata["resolution_method"] = resolved_name.resolution_method
        else:
            metadata["raw_target_name"] = parsed_request.target_name
            if is_placeholder:
                metadata["is_placeholder"] = True

        # Add age preference value if applicable
        if parsed_request.age_preference:
            metadata["preference_value"] = parsed_request.age_preference.value

        # Create the request
        request = BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=requested_cm_id,
            request_type=parsed_request.request_type,
            session_cm_id=options.session_cm_id,
            priority=priority,
            confidence_score=confidence_score,
            source=parsed_request.source,
            source_field=parsed_request.source_field,
            csv_position=options.csv_position,
            year=options.year,
            status=status,
            is_placeholder=is_placeholder,
            metadata=metadata,
        )

        # Validate if requested
        if options.validate and self.validation_pipeline:
            validation_result = self.validation_pipeline.validate(request)

            if not validation_result.is_valid:
                request.status = RequestStatus.DECLINED
                request.metadata["validation_errors"] = validation_result.errors
                request.metadata.update(validation_result.metadata)

        return request

    def build_batch(
        self,
        parsed_requests: list[ParsedRequest],
        resolved_names: list[ResolvedName | None],
        options: RequestBuilderOptions,
    ) -> list[BunkRequest]:
        """Build multiple requests efficiently.

        Args:
            parsed_requests: List of parsed requests
            resolved_names: List of resolved names (parallel to parsed_requests)
            options: Building options

        Returns:
            List of constructed BunkRequests
        """
        if len(parsed_requests) != len(resolved_names):
            raise ValueError(
                f"Mismatch between parsed requests ({len(parsed_requests)}) and resolved names ({len(resolved_names)})"
            )

        requests = []
        for i, (parsed, resolved) in enumerate(zip(parsed_requests, resolved_names, strict=False)):
            # Update CSV position for each request
            batch_options = RequestBuilderOptions(
                session_cm_id=options.session_cm_id,
                year=options.year,
                csv_position=i,
                default_priority=options.default_priority,
                validate=options.validate,
            )

            request = self.build(parsed_request=parsed, resolved_name=resolved, options=batch_options)
            requests.append(request)

        return requests
