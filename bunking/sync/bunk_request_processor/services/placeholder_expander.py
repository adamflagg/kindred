"""PlaceholderExpander service for expanding group reference requests.

Uses a pluggable resolver registry to expand group references (siblings,
bunkmates, classmates, congregation-mates) into individual bunk requests.

Each group kind maps to a GroupResolver that knows how to look up members.
The expander creates individual ParseResult+ResolutionResult pairs for each
resolved group member.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger

from ..core.models import (
    GroupKind,
    ParsedRequest,
    ParseResult,
)
from ..resolution.interfaces import ResolutionResult

if TYPE_CHECKING:
    from ..data.repositories.attendee_repository import AttendeeRepository
    from ..data.repositories.person_repository import PersonRepository
    from .group_resolvers import GroupResolver, ResolvedGroupMember

logger = get_logger(__name__)


class PlaceholderExpander:
    """Service for expanding group reference requests into individual requests.

    Supports two detection paths:
    1. Modern: parsed_request.group_kind is set by AI (preferred)
    2. Legacy: resolution metadata contains placeholder string (backward compat)

    Both paths dispatch to the same resolver registry for expansion.
    """

    def __init__(
        self,
        attendee_repo: AttendeeRepository,
        person_repo: PersonRepository,
        year: int,
    ) -> None:
        if year <= 0:
            raise ValueError("year must be positive")

        self._attendee_repo = attendee_repo
        self._person_repo = person_repo
        self.year = year

    async def expand(
        self,
        resolution_results: list[tuple[ParseResult, list[ResolutionResult]]],
        resolver_registry: dict[GroupKind, GroupResolver] | None = None,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Expand group reference requests into individual requests.

        Args:
            resolution_results: List of (ParseResult, List[ResolutionResult]) from Phase 2
            resolver_registry: Optional registry mapping GroupKind to resolvers.
                When None, falls back to legacy placeholder detection only.

        Returns:
            Updated list with group references expanded to individual requests
        """
        if not resolution_results:
            return []

        expanded_results: list[tuple[ParseResult, list[ResolutionResult]]] = []

        for parse_result, resolution_list in resolution_results:
            if not parse_result.is_valid or not parse_result.parsed_requests:
                expanded_results.append((parse_result, resolution_list))
                continue

            # Find group references (modern group_kind or legacy placeholders)
            group_refs = self._find_group_references(parse_result, resolution_list)
            if not group_refs:
                expanded_results.append((parse_result, resolution_list))
                continue

            # Expand each group reference
            for idx, group_kind in group_refs:
                if resolver_registry and group_kind in resolver_registry:
                    resolver = resolver_registry[group_kind]
                    expanded = self._expand_via_resolver(parse_result, resolution_list, idx, group_kind, resolver)
                    expanded_results.extend(expanded)
                else:
                    logger.warning(f"No resolver for group kind: {group_kind}")
                    expanded_results.extend(
                        self._handle_expansion_failure(parse_result, resolution_list, idx, group_kind)
                    )

        return expanded_results

    def _find_group_references(
        self, parse_result: ParseResult, resolution_list: list[ResolutionResult]
    ) -> list[tuple[int, GroupKind]]:
        """Find all group references in a parse result's intents.

        Checks parsed_request.group_kind field set by AI.
        """
        groups: list[tuple[int, GroupKind]] = []

        for idx, parsed_req in enumerate(parse_result.parsed_requests):
            if parsed_req.group_kind is not None:
                groups.append((idx, parsed_req.group_kind))

        return groups

    def _expand_via_resolver(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        idx: int,
        group_kind: GroupKind,
        resolver: GroupResolver,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Expand a single group reference using its resolver."""
        parsed_req = parse_result.parsed_requests[idx]
        original_parse_request = parse_result.parse_request

        if original_parse_request is None:
            return []

        requester_cm_id = original_parse_request.requester_cm_id
        session_cm_id = original_parse_request.session_cm_id

        logger.info(f"Expanding {group_kind.value} for requester {requester_cm_id}")

        members = resolver.resolve(
            requester_cm_id=requester_cm_id,
            parsed_request=parsed_req,
            session_cm_id=session_cm_id,
        )

        if not members:
            return self._handle_expansion_failure(parse_result, resolution_list, idx, group_kind)

        return self._create_expanded_requests(parsed_req, original_parse_request, members, group_kind)

    def _create_expanded_requests(
        self,
        parsed_req: ParsedRequest,
        original_parse_request: Any,
        members: list[ResolvedGroupMember],
        group_kind: GroupKind,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Create individual requests for each resolved group member."""
        logger.info(f"Expanding {group_kind.value} to {len(members)} individual requests")

        expanded_results: list[tuple[ParseResult, list[ResolutionResult]]] = []

        for member in members:
            member_name = member.person.full_name

            new_parsed_request = ParsedRequest(
                raw_text=parsed_req.raw_text,
                request_type=member.request_type,
                target_name=member_name,
                age_preference=None,
                source_field=parsed_req.source_field,
                source=parsed_req.source,
                confidence=member.confidence,
                csv_position=parsed_req.csv_position,
                metadata={
                    **member.metadata,
                    "expanded_from": group_kind.value,
                },
                notes=f"Auto-expanded from {group_kind.value} reference to {member_name}",
            )

            new_parse_result = ParseResult(
                parsed_requests=[new_parsed_request],
                needs_historical_context=False,
                is_valid=True,
                parse_request=original_parse_request,
                metadata={
                    "expanded_from_placeholder": True,
                    "original_placeholder": group_kind.value,
                },
            )

            new_resolution = ResolutionResult(
                person=member.person,
                confidence=member.confidence,
                method=f"{group_kind.value}_expansion",
                metadata={
                    **member.metadata,
                    "expanded_from": group_kind.value,
                },
            )

            expanded_results.append((new_parse_result, [new_resolution]))
            logger.info(
                f"  - Created {member.request_type.value} request for {member_name} (ID: {member.person.cm_id})"
            )

        return expanded_results

    def _handle_expansion_failure(
        self,
        parse_result: ParseResult,
        resolution_list: list[ResolutionResult],
        idx: int,
        group_kind: GroupKind,
    ) -> list[tuple[ParseResult, list[ResolutionResult]]]:
        """Handle cases where group reference expansion fails (resolver returned empty)."""
        reason = f"No members found for {group_kind.value} expansion"
        logger.warning(f"Cannot expand {group_kind.value}: {reason}")

        updated_resolution = ResolutionResult(
            person=None,
            confidence=0.0,
            method="placeholder_expansion_failed",
            metadata={
                "group_kind": group_kind.value,
                "expansion_failure_reason": reason,
            },
        )

        new_resolution_list = resolution_list.copy()
        if idx < len(new_resolution_list):
            new_resolution_list[idx] = updated_resolution
        else:
            new_resolution_list.append(updated_resolution)

        return [(parse_result, new_resolution_list)]
