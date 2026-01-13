"""V2 AI Provider - OpenAI SDK with Pydantic structured outputs.

Uses the Responses API for schema-enforced structured outputs.
GPT-4.1 models fully support structured outputs via this API.
"""

from __future__ import annotations

import logging
from typing import Any

from openai import AsyncOpenAI

from ..core.models import (
    AgePreference,
    ParsedRequest,
    RequestSource,
    RequestType,
)
from ..prompts import format_prompt
from ..utils.date_parser import parse_temporal_date
from .ai_schemas import (
    AIBunkRequestItem,
    AIDisambiguationResponse,
    AIParseResponse,
)
from .ai_service import AIProvider, AIRequestContext, ParsedResponse, TokenUsage

logger = logging.getLogger(__name__)


class OpenAIProvider(AIProvider):
    """OpenAI SDK-based AI provider with Pydantic structured outputs.

    Uses the Responses API with schema enforcement for guaranteed valid output.
    No manual JSON parsing - the SDK handles deserialization automatically.
    """

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        timeout: float = 60.0,
    ):
        """Initialize the V2 AI provider.

        Args:
            api_key: OpenAI API key
            model: Model name (e.g., 'gpt-4.1-nano')
            base_url: Optional custom API base URL
            timeout: Request timeout in seconds
        """
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

        # Track token usage
        self._total_prompt_tokens = 0
        self._total_completion_tokens = 0

        # Initialize OpenAI client
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )

    @property
    def name(self) -> str:
        return "v2_openai"

    async def parse_request(
        self,
        request_text: str,
        context: AIRequestContext,
    ) -> ParsedResponse:
        """Parse a bunk request using structured outputs.

        Uses the Responses API with Pydantic schema enforcement.
        The AI is constrained to output valid schema-conforming JSON.
        """
        if not self.api_key:
            logger.error("No API key configured")
            return ParsedResponse(
                requests=[],
                confidence=0.0,
                metadata={"error": "No API key configured", "error_type": "missing_api_key"},
            )

        try:
            # Build the prompt (without JSON format instructions - schema handles that)
            prompt = self._build_prompt(request_text, context)

            logger.debug(f"AI prompt: {prompt[:500]}..." if len(prompt) > 500 else f"AI prompt: {prompt}")

            # Call OpenAI with structured output
            parsed_response = await self._call_with_structured_output(
                prompt=prompt,
                response_model=AIParseResponse,
            )

            # Log response for debugging
            preview = request_text if len(request_text) <= 200 else f"{request_text[:200]}..."
            logger.info(f"AI response for '{preview}': {parsed_response}")

            # Convert to internal format (parsed_response is AIParseResponse here)
            if isinstance(parsed_response, AIParseResponse):
                return self._convert_parse_response(parsed_response, request_text, context)
            # Should not happen for parse requests, but return error response for type safety
            return ParsedResponse(
                requests=[],
                confidence=0.0,
                metadata={"error": "Unexpected response type for parse request"},
            )

        except Exception as e:
            import traceback

            logger.error(f"V2 AI provider error: {e}\n{traceback.format_exc()}")
            return ParsedResponse(
                requests=[],
                confidence=0.0,
                metadata={"error": str(e), "error_type": type(e).__name__},
            )

    async def batch_parse_requests(
        self,
        requests: list[tuple[str, AIRequestContext]],
    ) -> list[ParsedResponse]:
        """Parse multiple requests sequentially.

        TODO: Implement true batch processing for better performance.
        """
        responses = []
        for i, (text, context) in enumerate(requests):
            logger.info(f"Processing batch request {i + 1}/{len(requests)}")
            response = await self.parse_request(text, context)
            responses.append(response)
        return responses

    def get_token_usage(self) -> TokenUsage:
        """Get cumulative token usage statistics."""
        return TokenUsage(
            prompt_tokens=self._total_prompt_tokens,
            completion_tokens=self._total_completion_tokens,
            total_cost=self._calculate_cost(),
        )

    async def health_check(self) -> bool:
        """Check if the API is accessible."""
        try:
            # Simple test request
            test_context = AIRequestContext(
                requester_name="Test User",
                requester_cm_id=1,
                session_cm_id=1,
                year=2025,
                additional_context={"parse_only": True},
            )
            response = await self.parse_request("test", test_context)
            return response is not None
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False

    async def _call_with_structured_output(
        self,
        prompt: str,
        response_model: type[AIParseResponse] | type[AIDisambiguationResponse],
    ) -> AIParseResponse | AIDisambiguationResponse:
        """Call OpenAI with Pydantic structured output.

        Uses the Responses API for schema-enforced output.
        The model is constrained to output valid schema-conforming JSON.
        """
        response = await self.client.responses.parse(
            model=self.model,
            input=prompt,
            text_format=response_model,
            instructions="You are an expert at parsing summer camp bunk requests.",
        )

        # Update token usage
        if hasattr(response, "usage") and response.usage:
            self._total_prompt_tokens += getattr(response.usage, "input_tokens", 0)
            self._total_completion_tokens += getattr(response.usage, "output_tokens", 0)

        # Extract parsed content from response
        message = response.output[0]
        content = message.content  # type: ignore[union-attr]
        if content and len(content) > 0:
            text = content[0]
            parsed_result = getattr(text, "parsed", None)
            if parsed_result is not None and isinstance(parsed_result, (AIParseResponse, AIDisambiguationResponse)):
                result: AIParseResponse | AIDisambiguationResponse = parsed_result
                return result
        raise ValueError("Failed to extract parsed response from OpenAI output")

    def _build_prompt(self, request_text: str, context: AIRequestContext) -> str:
        """Build the prompt for parsing using field-specific templates.

        Selects the appropriate prompt template based on field type. Each field
        has its own template with tailored examples and source attribution.
        Falls back to generic parse_request.txt for unknown field types.
        """
        requester_info = f"Requester: {context.requester_name}\n"
        if context.additional_context.get("requester_grade"):
            requester_info += f"Grade: {context.additional_context['requester_grade']}\n"
        if context.additional_context.get("session_name"):
            requester_info += f"Session: {context.additional_context['session_name']}\n"

        # Select field-specific prompt template
        prompt_name = self._get_prompt_name_for_field(context.field_type)
        logger.debug(f"Using prompt template '{prompt_name}' for field type '{context.field_type}'")

        return format_prompt(
            prompt_name,
            requester_info=requester_info,
            request_text=request_text,
        )

    def _get_prompt_name_for_field(self, field_type: str | None) -> str:
        """Get the prompt template name for a field type.

        Each field type has its own prompt template with:
        - Field-specific source attribution (family vs staff)
        - Tailored examples from actual data
        - Appropriate request type restrictions

        Falls back to 'parse_request' for unknown field types.

        Note: field_type values come from SourceField constants which use
        canonical CSV column names like "Share Bunk With", not snake_case.
        """
        if not field_type:
            return "parse_request"

        # Map canonical SourceField values to prompt template names
        # These match the values in shared/constants.py:SourceField
        prompt_map = {
            "Share Bunk With": "parse_bunk_with",
            "Do Not Share Bunk With": "parse_not_bunk_with",
            "BunkingNotes Notes": "parse_bunking_notes",
            "Internal Bunk Notes": "parse_internal_notes",
        }
        return prompt_map.get(field_type, "parse_request")

    def _convert_parse_response(
        self,
        ai_response: AIParseResponse,
        original_text: str,
        context: AIRequestContext,
    ) -> ParsedResponse:
        """Convert Pydantic response to internal format."""
        v2_requests = []

        for ai_req in ai_response.requests:
            request_type = self._map_request_type(ai_req.request_type)

            # Extract temporal info if present
            temporal_date = None
            is_superseded = False
            supersedes_reason = None

            if ai_req.temporal_info:
                # Handle both dict and Pydantic model (SDK sometimes returns nested objects as dicts)
                ti = ai_req.temporal_info
                if isinstance(ti, dict):
                    date_mentioned = ti.get("date_mentioned")
                    is_superseded = ti.get("is_superseded", False)
                    supersedes_reason = ti.get("supersedes_reason")
                else:
                    date_mentioned = ti.date_mentioned
                    is_superseded = ti.is_superseded
                    supersedes_reason = ti.supersedes_reason

                temporal_date = parse_temporal_date(date_mentioned, context.year)

            # Build metadata dict with AI response fields
            request_metadata: dict[str, Any] = {
                "keywords_found": ai_req.keywords_found,
                "parse_notes": ai_req.parse_notes,
                "reasoning": ai_req.reasoning,
                "needs_clarification": ai_req.needs_clarification,
                "ambiguity_reason": ai_req.ambiguity_reason,
                "source_type": ai_req.source_type,
            }

            # Include staff_metadata if present in context (for bunking_notes fields)
            staff_metadata = context.additional_context.get("staff_metadata")
            if staff_metadata:
                request_metadata["staff_metadata"] = staff_metadata

            parsed_request = ParsedRequest(
                raw_text=original_text,
                request_type=request_type,
                target_name=ai_req.target_name,
                age_preference=None,
                source_field=ai_req.source_field or context.csv_source_field or "unknown",
                source=self._map_source_type(ai_req.source_type),
                confidence=self._calculate_confidence(ai_req),
                csv_position=ai_req.list_position + 1,  # Convert 0-based to 1-based
                metadata=request_metadata,
                notes=ai_req.parse_notes,
                temporal_date=temporal_date,
                is_superseded=is_superseded,
                supersedes_reason=supersedes_reason,
            )

            # Handle age preference
            if request_type == RequestType.AGE_PREFERENCE and parsed_request.target_name:
                age_pref_map = {
                    "older": AgePreference.OLDER,
                    "younger": AgePreference.YOUNGER,
                }
                parsed_request.age_preference = age_pref_map.get(
                    parsed_request.target_name.lower(),
                    None,  # "unclear" maps to None for manual review
                )
                parsed_request.target_name = None

            v2_requests.append(parsed_request)

        avg_confidence = sum(r.confidence for r in v2_requests) / len(v2_requests) if v2_requests else 0.0

        return ParsedResponse(
            requests=v2_requests,
            confidence=avg_confidence,
            metadata={
                "provider": self.name,
                "model": self.model,
                "parse_only": context.parse_only,
            },
        )

    def _map_request_type(self, ai_type: str) -> RequestType:
        """Map AI request type to internal enum."""
        mapping = {
            "bunk_with": RequestType.BUNK_WITH,
            "not_bunk_with": RequestType.NOT_BUNK_WITH,
            "age_preference": RequestType.AGE_PREFERENCE,
        }
        return mapping.get(ai_type, RequestType.BUNK_WITH)

    def _map_source_type(self, ai_source: str) -> RequestSource:
        """Map AI source type to internal enum."""
        mapping = {
            "parent": RequestSource.FAMILY,
            "family": RequestSource.FAMILY,
            "counselor": RequestSource.STAFF,
            "staff": RequestSource.STAFF,
            "notes": RequestSource.NOTES,
        }
        return mapping.get(ai_source.lower(), RequestSource.FAMILY)

    def _calculate_confidence(self, ai_req: AIBunkRequestItem) -> float:
        """Calculate confidence score for a parsed request."""
        confidence = 0.85  # Higher base - schema enforcement means valid structure

        if ai_req.needs_clarification:
            confidence *= 0.8

        if ai_req.ambiguity_reason:
            confidence *= 0.9

        return min(confidence, 1.0)

    def _calculate_cost(self) -> float:
        """Calculate approximate cost based on token usage."""
        # Pricing per 1M tokens (approximate)
        pricing = {
            "gpt-4o": (5.0, 15.0),
            "gpt-4o-mini": (0.15, 0.6),
            "gpt-4.1-nano": (0.10, 0.40),
            "gpt-4.1-mini": (0.40, 1.60),
            "gpt-4.1": (2.0, 8.0),
        }

        input_price, output_price = 0.0, 0.0
        for model_prefix, prices in pricing.items():
            if model_prefix in self.model.lower():
                input_price, output_price = prices
                break

        input_cost = (self._total_prompt_tokens / 1_000_000) * input_price
        output_cost = (self._total_completion_tokens / 1_000_000) * output_price

        return input_cost + output_cost

    async def disambiguate(
        self,
        parsed_request: ParsedRequest,
        context: dict[str, Any],
    ) -> ParsedResponse:
        """Phase 3: AI-assisted disambiguation with minimal context.

        Loads prompt template from config/prompts/disambiguate.txt.
        Uses structured output to select from candidate matches.
        """
        candidates_text = self._format_candidates(context.get("candidates", []))

        prompt = format_prompt(
            "disambiguate",
            target_name=parsed_request.target_name or "",
            requester_name=context.get("requester_name", "Unknown"),
            requester_cm_id=str(context.get("requester_cm_id", 0)),
            requester_school=context.get("requester_school", "Unknown"),
            candidates_text=candidates_text,
            local_confidence=str(context.get("local_confidence", 0)),
            ambiguity_reason=context.get("ambiguity_reason", "multiple matches"),
        )

        try:
            response = await self._call_with_structured_output(
                prompt=prompt,
                response_model=AIDisambiguationResponse,
            )

            # Update parsed request with disambiguation result
            if isinstance(response, AIDisambiguationResponse) and response.selected_person_id:
                parsed_request.metadata["target_person_id"] = response.selected_person_id
                parsed_request.confidence = response.confidence
                parsed_request.metadata["disambiguation_method"] = "ai_phase3"
                parsed_request.metadata["disambiguation_reasoning"] = response.reasoning

            return ParsedResponse(
                requests=[parsed_request],
                confidence=parsed_request.confidence,
                metadata={"phase": 3, "disambiguated": True},
            )

        except Exception as e:
            logger.error(f"Disambiguation error: {e}")
            return ParsedResponse(
                requests=[parsed_request],
                confidence=0.0,
                metadata={"phase": 3, "error": str(e)},
            )

    def _format_candidates(self, candidates: list[dict[str, Any]]) -> str:
        """Format candidate information for disambiguation prompt."""
        lines = []
        for i, candidate in enumerate(candidates, 1):
            line = f"{i}. {candidate['name']} (ID: {candidate['person_id']})"

            details = []
            if candidate.get("school"):
                details.append(f"School: {candidate['school']}")
            if candidate.get("grade"):
                details.append(f"Grade: {candidate['grade']}")
            if candidate.get("age"):
                details.append(f"Age: {candidate['age']}")
            if candidate.get("social_distance") is not None:
                details.append(f"Social distance: {candidate['social_distance']}")
            if candidate.get("mutual_connections"):
                details.append(f"Mutual friends: {candidate['mutual_connections']}")

            if details:
                line += f" - {', '.join(details)}"

            if candidate.get("found_by"):
                line += f" [Found by: {candidate['found_by']}]"

            lines.append(line)

        return "\n".join(lines)

    async def simple_completion(self, prompt: str) -> str:
        """Simple text completion without structured output.

        Used for extraction tasks where raw text response is needed.
        """
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=500,
        )

        if response.usage:
            self._total_prompt_tokens += response.usage.prompt_tokens
            self._total_completion_tokens += response.usage.completion_tokens

        return response.choices[0].message.content or ""

    async def close(self) -> None:
        """Close the client and release resources."""
        if self.client:
            await self.client.close()

    async def __aenter__(self) -> OpenAIProvider:
        """Async context manager entry."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        """Async context manager exit - cleanup."""
        await self.close()
