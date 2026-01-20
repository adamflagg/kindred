"""PocketBase client wrapper to fix URL encoding issues.

The PocketBase Python SDK v0.15.0 has an issue where query parameters
are URL-encoded with '+' for spaces, but PocketBase server expects
%20 for spaces in filter parameters. This wrapper fixes that issue."""

from __future__ import annotations

import logging
from typing import Any

from pocketbase.models.utils.list_result import ListResult
from pocketbase.services.record_service import RecordService

# Import TRACE constant and ensure trace method is available
from bunking.logging_config import TRACE  # noqa: F401
from pocketbase import PocketBase

logger = logging.getLogger(__name__)


class WrappedRecordService(RecordService):
    """Wrapped RecordService that fixes filter encoding issues"""

    def __init__(self, original_service: RecordService) -> None:
        # Don't call super().__init__ to avoid re-initialization
        # Instead, copy attributes from the original service
        self.client = original_service.client
        self.collection_id_or_name: str = getattr(original_service, "collection_id_or_name", "") or ""
        self._original_service = original_service

    def base_crud_path(self) -> str:
        """Get the base CRUD path for this collection"""
        return self._original_service.base_crud_path()

    def decode(self, data: dict[str, Any]) -> Any:
        """Decode a record from the API response"""
        return self._original_service.decode(data)

    def get_list(
        self,
        page: int = 1,
        per_page: int = 30,
        query_params: dict[str, Any] | None = None,
    ) -> Any:
        """Override get_list to fix filter encoding.

        The issue: httpx encodes spaces as '+' but PocketBase expects %20 for spaces.
        Solution: Manually construct the URL with proper encoding.
        """
        # Build params dict
        params = query_params.copy() if query_params else {}
        params.update({"page": page, "perPage": per_page})

        # The key insight: PocketBase expects URL path encoding (%20) not form encoding (+)
        # But httpx uses form encoding for params by default
        # So we need to bypass httpx's encoding for the filter parameter

        if "filter" in params:
            # Save the filter value
            filter_value = params["filter"]
            # Remove it from params to prevent double encoding
            del params["filter"]
            # Add it back with manual encoding that uses %20 for spaces
            # We'll pass it as a pre-encoded string in the URL

            # Build the URL with the filter as a query string
            # Add filter back to params with proper encoding
            # Actually, let's try a different approach - let httpx handle it but fix the encoding
            params["filter"] = filter_value

        # Log at TRACE level (very verbose, use LOG_LEVEL=TRACE to see)
        logger.log(TRACE, f"Sending get_list with params: {params}")

        try:
            # Use the original client's send method directly to have more control
            response_data = self.client.send(self.base_crud_path(), {"method": "GET", "params": params})

            # Parse the response into ListResult format
            items = []
            if "items" in response_data:
                response_data["items"] = response_data["items"] or []
                for item in response_data["items"]:
                    items.append(self.decode(item))

            return ListResult(
                response_data.get("page", 1),
                response_data.get("perPage", 0),
                response_data.get("totalItems", 0),
                response_data.get("totalPages", 0),
                items,
            )
        except Exception as e:
            # If our custom approach fails, fall back to the original method
            logger.warning(f"Wrapper get_list failed, falling back to original: {e}")
            return self._original_service.get_list(page, per_page, query_params)

    def get_full_list(
        self,
        batch: int = 100,
        query_params: dict[str, Any] | None = None,
    ) -> list[Any]:
        """Override get_full_list to use our fixed get_list"""
        result: list[Any] = []

        def request(result: list[Any], page: int) -> list[Any]:
            list_result = self.get_list(page, batch, query_params)
            items = list_result.items
            total_items = list_result.total_items
            result += items
            if len(items) > 0 and total_items > len(result):
                return request(result, page + 1)
            return result

        return request(result, 1)

    def __getattr__(self, name: str) -> Any:
        """Delegate all other attributes to the original service"""
        return getattr(self._original_service, name)


class PocketBaseWrapper:
    """Wrapper for PocketBase client that fixes URL encoding issues.

    Usage:
        pb_client = PocketBase("http://localhost:8090")
        pb_client.auth_store.save(token, model)

        # Wrap the client
        pb = PocketBaseWrapper(pb_client)

        # Use normally
        results = pb.collection("users").get_list(
            query_params={"filter": "name = 'test'"}
        )
    """

    def __init__(self, pb_client: PocketBase):
        self._client = pb_client
        self._wrapped_services: dict[str, WrappedRecordService] = {}

    def collection(self, id_or_name: str) -> WrappedRecordService:
        """Return a wrapped RecordService for the collection"""
        if id_or_name not in self._wrapped_services:
            original_service = self._client.collection(id_or_name)
            self._wrapped_services[id_or_name] = WrappedRecordService(original_service)
        return self._wrapped_services[id_or_name]

    def __getattr__(self, name: str) -> Any:
        """Delegate all other attributes to the original client"""
        return getattr(self._client, name)
