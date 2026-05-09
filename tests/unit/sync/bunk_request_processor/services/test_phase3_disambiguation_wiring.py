"""Tests that Phase 3 disambiguation calls the correct AI method with proper args."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.integration.ai_schemas import AIDisambiguationResponse


class TestBatchProcessorDisambiguation:
    """batch_processor calls ai_provider.disambiguate() for disambiguation batches."""

    @pytest.mark.asyncio
    async def test_disambiguation_calls_disambiguate_not_parse_request(self):
        """The critical fix: disambiguation must call disambiguate(), not parse_request()."""
        from bunking.sync.bunk_request_processor.integration.batch_processor import BatchProcessor

        mock_provider = AsyncMock()
        mock_provider.disambiguate = AsyncMock(
            return_value=MagicMock(
                requests=[],
                metadata={},
            )
        )
        mock_provider.parse_request = AsyncMock()

        processor = BatchProcessor.__new__(BatchProcessor)
        processor.ai_provider = mock_provider
        processor.stats = {
            "transient_item_failures": 0,
            "partial_batches": 0,
            "successful_batches": 0,
            "total_batches": 0,
            "total_items": 0,
            "total_time": 0,
            "failed_batches": 0,
            "rate_limited_batches": 0,
            "total_retries": 0,
        }
        processor._check_rate_limits = AsyncMock()  # type: ignore[method-assign]

        parsed_req = ParsedRequest(
            raw_text="Emma",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma",
            age_preference=None,
            source_field="bunk_with",
            confidence=0.5,
            csv_position=0,
            metadata={},
        )
        context = MagicMock()  # AIRequestContext

        batch = [(parsed_req, context)]
        await processor._process_batch_with_retry(0, batch, None, is_disambiguation=True)

        mock_provider.disambiguate.assert_called_once()
        mock_provider.parse_request.assert_not_called()


class TestPhase3ResponseFields:
    """AIDisambiguationResponse field shape. Post #944: ranked_selections is canonical."""

    def test_response_has_ranked_selections_not_person_cm_id(self):
        """AIDisambiguationResponse exposes ranked_selections (not legacy person_cm_id)."""
        response = AIDisambiguationResponse()
        assert hasattr(response, "ranked_selections")
        assert not hasattr(response, "person_cm_id")
        assert not hasattr(response, "selected_person_id")
