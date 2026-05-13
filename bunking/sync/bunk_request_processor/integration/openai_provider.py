"""V2 AI Provider - OpenAI SDK with Pydantic structured outputs.

Uses the Responses API for schema-enforced structured outputs.
GPT-4.1 and GPT-5 models fully support structured outputs via this API.
"""

from __future__ import annotations

from typing import Any

from openai import APIConnectionError, APITimeoutError, AsyncOpenAI, InternalServerError, RateLimitError
from openai.types.shared_params import Reasoning, ReasoningEffort

from bunking.logging_config import TRACE, get_logger

from ..core.models import (
    AgePreference,
    ParsedRequest,
    RequestType,
)
from ..prompts import format_prompt
from ..shared.name_utils import parse_name
from ..utils.date_parser import parse_temporal_date
from .ai_schemas import (
    AIBunkRequestItem,
    AIDisambiguationResponse,
    AIParseResponse,
)
from .ai_types import AIProvider, AIRequestContext, ParsedResponse, TokenUsage

# Transient errors that should propagate for retry by callers.
# Non-transient errors (400 bad request, auth failures) are swallowed into empty responses.
TRANSIENT_ERRORS = (APITimeoutError, InternalServerError, RateLimitError, APIConnectionError)

# String patterns for detecting transient errors in wrapped/stringified exceptions.
# Used as fallback when isinstance checks aren't possible (e.g., error stored as string in metadata).
TRANSIENT_ERROR_PATTERNS = (
    "rate_limit",
    "429",
    "timeout",
    "timed out",
    "500",
    "internal server error",
    "apiconnectionerror",
)


def is_transient_error_string(error_str: str) -> bool:
    """Check if an error string indicates a transient failure."""
    return any(pat in error_str.lower() for pat in TRANSIENT_ERROR_PATTERNS)


logger = get_logger(__name__)


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
        debug: bool = False,
    ):
        """Initialize the V2 AI provider.

        Args:
            api_key: OpenAI API key
            model: Model name (e.g., 'gpt-5-nano')
            base_url: Optional custom API base URL
            timeout: Request timeout in seconds
            debug: Enable verbose AI parse logging
        """
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self.debug = debug

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

            logger.log(TRACE, f"AI prompt: {prompt[:500]}..." if len(prompt) > 500 else f"AI prompt: {prompt}")

            # Debug logging: show exact AI input
            if self.debug:
                logger.info(
                    f"[AI-PARSE] Input: field='{context.field_type}' "
                    f"requester='{context.requester_name}' text='{request_text}'"
                )

            # Call OpenAI with structured output
            parsed_response, reasoning_summary = await self._call_with_structured_output(
                prompt=prompt,
                response_model=AIParseResponse,
            )

            # Debug logging: show exact AI output
            if self.debug and isinstance(parsed_response, AIParseResponse):
                target_names = [r.target_name for r in parsed_response.requests]
                request_types = [r.request_type for r in parsed_response.requests]
                age_directions = [r.age_direction for r in parsed_response.requests]
                logger.debug(
                    f"[AI-PARSE] Output: targets={target_names} request_types={request_types} "
                    f"age_directions={age_directions}"
                )
                if reasoning_summary:
                    logger.debug(f"[AI-PARSE] Reasoning: {reasoning_summary}")

            # Log response for debugging
            preview = request_text if len(request_text) <= 200 else f"{request_text[:200]}..."
            logger.log(TRACE, f"AI response for '{preview}': {parsed_response}")
            if isinstance(parsed_response, AIParseResponse):
                logger.debug(f"AI parsed {len(parsed_response.requests)} target(s) for '{preview}'")

            # Convert to internal format (parsed_response is AIParseResponse here)
            if isinstance(parsed_response, AIParseResponse):
                result = self._convert_parse_response(parsed_response, request_text, context)
                if reasoning_summary:
                    result.metadata["ai_reasoning_summary"] = reasoning_summary
                return result
            # Should not happen for parse requests, but return error response for type safety
            return ParsedResponse(
                requests=[],
                confidence=0.0,
                metadata={"error": "Unexpected response type for parse request"},
            )

        except TRANSIENT_ERRORS:
            # Re-raise transient errors so callers (BatchProcessor) can retry
            raise

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
        """Parse multiple requests sequentially, tagging transient failures per-item.

        Individual transient errors (timeout, 500) are caught and tagged in the
        response metadata so BatchProcessor can identify retryable failures.
        The batch continues past individual failures.
        """
        responses = []
        for i, (text, context) in enumerate(requests):
            logger.info(f"Processing batch request {i + 1}/{len(requests)}")
            try:
                response = await self.parse_request(text, context)
                responses.append(response)
            except TRANSIENT_ERRORS as e:
                logger.warning(f"Transient error on batch item {i + 1}/{len(requests)}: {type(e).__name__}: {e}")
                responses.append(
                    ParsedResponse(
                        requests=[],
                        confidence=0.0,
                        metadata={
                            "error": str(e),
                            "error_type": type(e).__name__,
                            "transient_error": True,
                        },
                    )
                )
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

    def _supports_reasoning(self) -> bool:
        """Check if the configured model supports the reasoning parameter.

        Only reasoning-capable models (o-series, GPT-5) support this.
        GPT-4.1 and earlier models reject it with a 400 error.
        """
        model_lower = self.model.lower()
        return any(model_lower.startswith(prefix) for prefix in ("o1", "o3", "o4", "gpt-5"))

    async def _call_with_structured_output(
        self,
        prompt: str,
        response_model: type[AIParseResponse] | type[AIDisambiguationResponse],
        reasoning_effort: ReasoningEffort = "low",
    ) -> tuple[AIParseResponse | AIDisambiguationResponse, str | None]:
        """Call OpenAI with Pydantic structured output.

        Uses the Responses API for schema-enforced output.
        The model is constrained to output valid schema-conforming JSON.

        Args:
            reasoning_effort: Reasoning level for reasoning-capable models.
                "low" for Phase 1 parsing, "medium" for Phase 3 disambiguation.
                Ignored for models that don't support reasoning.

        Returns:
            Tuple of (parsed_result, reasoning_summary). The reasoning_summary
            is extracted from ResponseReasoningItem objects when reasoning is
            enabled, or None if no reasoning output is present.
        """
        # Only pass reasoning param for models that support it
        kwargs: dict[str, Any] = {
            "model": self.model,
            "input": prompt,
            "text_format": response_model,
            "instructions": "You are an expert at parsing summer camp bunk requests.",
        }
        if self._supports_reasoning():
            kwargs["reasoning"] = Reasoning(effort=reasoning_effort)

        response = await self.client.responses.parse(**kwargs)

        # Update token usage
        if hasattr(response, "usage") and response.usage:
            self._total_prompt_tokens += getattr(response.usage, "input_tokens", 0)
            self._total_completion_tokens += getattr(response.usage, "output_tokens", 0)

        # Extract structured reasoning summaries and parsed content from response.
        # With reasoning enabled, output contains reasoning items before the message.
        reasoning_texts: list[str] = []
        parsed_result: AIParseResponse | AIDisambiguationResponse | None = None

        for output_item in response.output:
            # Collect reasoning summaries
            summary_list = getattr(output_item, "summary", None)
            if summary_list:
                for summary in summary_list:
                    text = getattr(summary, "text", None)
                    if text:
                        reasoning_texts.append(text)

            # Find the parsed content
            if parsed_result is None:
                content = getattr(output_item, "content", None)
                if content and len(content) > 0:
                    candidate = getattr(content[0], "parsed", None)
                    if candidate is not None and isinstance(candidate, (AIParseResponse, AIDisambiguationResponse)):
                        parsed_result = candidate

        if parsed_result is None:
            raise ValueError("Failed to extract parsed response from OpenAI output")

        reasoning_summary = ". ".join(t.rstrip(".") for t in reasoning_texts) + "." if reasoning_texts else None
        return parsed_result, reasoning_summary

    def _build_prompt(self, request_text: str, context: AIRequestContext) -> str:
        """Build the prompt for parsing using field-specific templates.

        Selects the appropriate prompt template based on field type. Each field
        has its own template with tailored examples and source attribution.
        Falls back to generic parse_request.txt for unknown field types.
        """
        requester_info = f"Requester: {context.requester_name}\n"
        requester_last = parse_name(context.requester_name or "").last
        requester_info += f"Requester last name: {requester_last}\n"
        if context.additional_context.get("requester_grade"):
            requester_info += f"Grade: {context.additional_context['requester_grade']}\n"
        if context.additional_context.get("session_name"):
            requester_info += f"Session: {context.additional_context['session_name']}\n"
        if context.additional_context.get("requester_school"):
            requester_info += f"School: {context.additional_context['requester_school']}\n"
        if context.additional_context.get("requester_congregation"):
            requester_info += f"Congregation: {context.additional_context['requester_congregation']}\n"
        if context.additional_context.get("requester_city"):
            requester_info += f"City: {context.additional_context['requester_city']}\n"

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

        Note: field_type values come from SourceField constants (V2 internal names).
        """
        if not field_type:
            return "parse_request"

        # Map V2 SourceField values to prompt template names
        prompt_map = {
            "bunk_with": "parse_bunk_with",
            "not_bunk_with": "parse_not_bunk_with",
            "bunking_notes": "parse_bunking_notes",
            "internal_notes": "parse_internal_notes",
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
                "source_fragment": ai_req.source_fragment,
                "needs_clarification": ai_req.needs_clarification,
                "ambiguity_reason": ai_req.ambiguity_reason,
                "source_type": ai_req.source_type,
            }

            # Include historical_year if AI extracted one
            if ai_req.historical_year is not None:
                request_metadata["historical_year"] = ai_req.historical_year

            # Include staff_metadata if present in context (for bunking_notes fields)
            staff_metadata = context.additional_context.get("staff_metadata")
            if staff_metadata:
                request_metadata["staff_metadata"] = staff_metadata

            raw_field = ai_req.source_field or context.csv_source_field or "unknown"
            parsed_request = ParsedRequest(
                raw_text=original_text,
                request_type=request_type,
                target_name=ai_req.target_name,
                age_preference=None,
                source_field=raw_field,
                confidence=self._calculate_confidence(ai_req),
                csv_position=ai_req.list_position + 1,  # Convert 0-based to 1-based
                metadata=request_metadata,
                notes=ai_req.parse_notes,
                temporal_date=temporal_date,
                is_superseded=is_superseded,
                supersedes_reason=supersedes_reason,
            )

            # Handle age preference via structured age_direction field (#1401).
            if request_type == RequestType.AGE_PREFERENCE:
                if ai_req.target_name:
                    # Drift: AI emitted old-shape target_name on age_preference. Salvage as
                    # undirected — never silently re-map back to AgePreference, that masks
                    # the bug class age_direction was introduced to eliminate.
                    logger.error(
                        "AI drift: target_name=%r on age_preference request — clearing and "
                        "treating as undirected. AI must use age_direction field instead.",
                        ai_req.target_name,
                    )
                    parsed_request.target_name = None
                direction_map = {
                    "older": AgePreference.OLDER,
                    "younger": AgePreference.YOUNGER,
                }
                parsed_request.age_preference = (
                    direction_map.get(ai_req.age_direction) if ai_req.age_direction else None
                )

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
            "gpt-5-nano": (0.05, 0.40),
            "gpt-5-mini": (0.25, 2.0),
            "gpt-5": (2.0, 8.0),
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
        context: AIRequestContext,
    ) -> ParsedResponse:
        """Phase 3: AI-assisted disambiguation with minimal context.

        Loads prompt template from config/prompts/disambiguate.txt.
        Uses structured output to select from candidate matches.
        """
        ctx = context.additional_context or {}
        candidates_text = self._format_candidates(ctx.get("candidates", []))

        prompt = format_prompt(
            "disambiguate",
            target_name=parsed_request.target_name or "",
            requester_name=context.requester_name or "Unknown",
            requester_cm_id=str(context.requester_cm_id),
            requester_school=ctx.get("requester_school", "Unknown"),
            candidates_text=candidates_text,
            local_confidence=str(ctx.get("local_confidence", 0)),
            ambiguity_reason=ctx.get("ambiguity_reason", "multiple matches"),
        )

        try:
            response, reasoning_summary = await self._call_with_structured_output(
                prompt=prompt,
                response_model=AIDisambiguationResponse,
                reasoning_effort="medium",
            )

            # Update parsed request with disambiguation result
            if isinstance(response, AIDisambiguationResponse):
                if response.ranked_selections:
                    parsed_request.metadata["ranked_selections"] = [c.model_dump() for c in response.ranked_selections]
                    # Use top pick for backward compat fields
                    top = response.ranked_selections[0]
                    parsed_request.metadata["target_person_id"] = top.person_id
                    parsed_request.confidence = top.confidence
                    parsed_request.metadata["disambiguation_method"] = "ai_phase3"
                    parsed_request.metadata["disambiguation_reasoning"] = top.reasoning
                elif response.no_match:
                    parsed_request.metadata["no_match"] = True
                    parsed_request.metadata["no_match_reason"] = response.no_match_reason
                    parsed_request.confidence = 0.0
                else:
                    logger.debug(
                        f"Disambiguation response had no ranked_selections or no_match "
                        f"for target '{parsed_request.target_name}'"
                    )

            metadata: dict[str, Any] = {"phase": 3, "disambiguated": True}
            if reasoning_summary:
                metadata["ai_reasoning_summary"] = reasoning_summary

            return ParsedResponse(
                requests=[parsed_request],
                confidence=parsed_request.confidence,
                metadata=metadata,
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
            if candidate.get("grade") is not None:
                details.append(f"Grade: {candidate['grade']}")
            if candidate.get("age") is not None:
                details.append(f"Age: {candidate['age']}")
            if candidate.get("city"):
                details.append(f"City: {candidate['city']}")
            if candidate.get("congregation"):
                details.append(f"Congregation: {candidate['congregation']}")
            if candidate.get("parents"):
                details.append(f"Parents: {candidate['parents']}")
            if candidate.get("social_distance") is not None:
                details.append(f"Social distance: {candidate['social_distance']}")
            if candidate.get("mutual_connections") is not None:
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
