"""Source Link Repository for managing bunk_request_sources junction table.

Handles all database operations for linking bunk_requests to their contributing
original_bunk_requests. Enables:
- Cross-run deduplication (Field B matches existing Field A)
- Partial invalidation (when source changes, find affected requests)
- Merge/split tracking (multi-source requests)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pocketbase import PocketBase

    from ..pocketbase_wrapper import PocketBaseWrapper

logger = logging.getLogger(__name__)

COLLECTION_NAME = "bunk_request_sources"


class SourceLinkRepository:
    """Repository for bunk_request_sources junction table access."""

    def __init__(self, pb_client: PocketBase | PocketBaseWrapper) -> None:
        """Initialize repository with PocketBase client.

        Args:
            pb_client: PocketBase client instance
        """
        self.pb = pb_client

    def add_source_link(
        self,
        bunk_request_id: str,
        original_request_id: str,
        is_primary: bool,
        source_field: str | None = None,
    ) -> bool:
        """Create a new junction record linking a bunk_request to an original_request.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request
            original_request_id: PocketBase ID of the original_bunk_request
            is_primary: Whether this source "owns" the request
            source_field: Optional source field name for quick access

        Returns:
            True if created successfully, False on error (including duplicate)
        """
        try:
            data = {
                "bunk_request": bunk_request_id,
                "original_request": original_request_id,
                "is_primary": is_primary,
            }
            if source_field:
                data["source_field"] = source_field

            self.pb.collection(COLLECTION_NAME).create(data)
            return True

        except Exception as e:
            # Unique constraint violation is expected for duplicates
            logger.debug(f"Could not add source link: {e}")
            return False

    def get_sources_for_request(self, bunk_request_id: str) -> list[str]:
        """Get all original_request IDs linked to a bunk_request.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request

        Returns:
            List of original_request IDs
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": f'bunk_request = "{bunk_request_id}"', "perPage": 100}
            )
            return [item.original_request for item in result.items]

        except Exception as e:
            logger.warning(f"Error getting sources for request {bunk_request_id}: {e}")
            return []

    def get_requests_for_source(self, original_request_id: str) -> list[str]:
        """Get all bunk_request IDs linked to an original_request.

        This is crucial for partial invalidation - when an original_bunk_request
        changes, we need to find all bunk_requests that depend on it.

        Args:
            original_request_id: PocketBase ID of the original_bunk_request

        Returns:
            List of bunk_request IDs
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": f'original_request = "{original_request_id}"', "perPage": 100}
            )
            return [item.bunk_request for item in result.items]

        except Exception as e:
            logger.warning(f"Error getting requests for source {original_request_id}: {e}")
            return []

    def remove_source_link(
        self,
        bunk_request_id: str,
        original_request_id: str,
    ) -> bool:
        """Remove a specific source link.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request
            original_request_id: PocketBase ID of the original_bunk_request

        Returns:
            True if deleted, False if not found or error
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'bunk_request = "{bunk_request_id}" && original_request = "{original_request_id}"',
                    "perPage": 1,
                }
            )

            if not result.items:
                return False

            self.pb.collection(COLLECTION_NAME).delete(result.items[0].id)
            return True

        except Exception as e:
            logger.warning(f"Error removing source link: {e}")
            return False

    def remove_all_links_for_request(self, bunk_request_id: str) -> int:
        """Remove all source links for a bunk_request.

        Used when deleting a bunk_request - must clean up junction table.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request

        Returns:
            Number of links deleted
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": f'bunk_request = "{bunk_request_id}"', "perPage": 100}
            )

            deleted = 0
            for item in result.items:
                try:
                    self.pb.collection(COLLECTION_NAME).delete(item.id)
                    deleted += 1
                except Exception as e:
                    logger.warning(f"Error deleting link {item.id}: {e}")

            return deleted

        except Exception as e:
            logger.warning(f"Error removing all links for request {bunk_request_id}: {e}")
            return 0

    def get_primary_source(self, bunk_request_id: str) -> str | None:
        """Get the primary source for a bunk_request.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request

        Returns:
            Original_request ID of the primary source, or None if not found
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'bunk_request = "{bunk_request_id}" && is_primary = true',
                    "perPage": 1,
                }
            )

            if result.items:
                return result.items[0].original_request

        except Exception as e:
            logger.warning(f"Error getting primary source for {bunk_request_id}: {e}")

        return None

    def transfer_primary_status(
        self,
        bunk_request_id: str,
        new_primary_original_id: str,
    ) -> bool:
        """Transfer primary status from one source to another.

        Used when merging requests - the new source becomes primary.

        Args:
            bunk_request_id: PocketBase ID of the bunk_request
            new_primary_original_id: Original_request ID to make primary

        Returns:
            True if transfer succeeded, False otherwise
        """
        try:
            # Find and update the old primary (set is_primary=false)
            old_primary_result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'bunk_request = "{bunk_request_id}" && is_primary = true',
                    "perPage": 1,
                }
            )

            if old_primary_result.items:
                self.pb.collection(COLLECTION_NAME).update(
                    old_primary_result.items[0].id, {"is_primary": False}
                )

            # Find and update the new primary (set is_primary=true)
            new_primary_result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={
                    "filter": f'bunk_request = "{bunk_request_id}" && original_request = "{new_primary_original_id}"',
                    "perPage": 1,
                }
            )

            if new_primary_result.items:
                self.pb.collection(COLLECTION_NAME).update(
                    new_primary_result.items[0].id, {"is_primary": True}
                )
                return True

            logger.warning(f"New primary source {new_primary_original_id} not found for {bunk_request_id}")
            return False

        except Exception as e:
            logger.warning(f"Error transferring primary status: {e}")
            return False

    def count_sources_for_request(self, bunk_request_id: str) -> int:
        """Count how many sources are linked to a request.

        Useful for determining if a request is merged (count > 1).

        Args:
            bunk_request_id: PocketBase ID of the bunk_request

        Returns:
            Number of linked sources
        """
        try:
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": f'bunk_request = "{bunk_request_id}"', "perPage": 1}
            )
            return result.total_items

        except Exception as e:
            logger.warning(f"Error counting sources for {bunk_request_id}: {e}")
            return 0

    def is_single_source(self, bunk_request_id: str) -> bool:
        """Check if a request has only one source (should be deleted on change).

        Args:
            bunk_request_id: PocketBase ID of the bunk_request

        Returns:
            True if request has exactly one source
        """
        return self.count_sources_for_request(bunk_request_id) == 1

    def transfer_all_sources(
        self,
        from_request_id: str,
        to_request_id: str,
    ) -> int:
        """Transfer all source links from one request to another.

        When merging request B into request A:
        - Keep A's sources
        - Transfer B's sources to A (as non-primary)
        - Delete B's original links

        Args:
            from_request_id: Request to transfer sources FROM (will be deleted)
            to_request_id: Request to transfer sources TO (will be kept)

        Returns:
            Number of sources transferred
        """
        try:
            # Get all sources from the request being merged away
            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": f'bunk_request = "{from_request_id}"', "perPage": 100}
            )

            transferred = 0
            for item in result.items:
                # Create new link to the kept request (as non-primary)
                try:
                    self.pb.collection(COLLECTION_NAME).create(
                        {
                            "bunk_request": to_request_id,
                            "original_request": item.original_request,
                            "is_primary": False,  # Non-primary since it's a merge
                            "source_field": getattr(item, "source_field", None),
                        }
                    )
                    transferred += 1
                except Exception as e:
                    # May already exist if same original_request linked to both
                    logger.debug(f"Could not transfer link (may be duplicate): {e}")

                # Delete the old link
                try:
                    self.pb.collection(COLLECTION_NAME).delete(item.id)
                except Exception as e:
                    logger.warning(f"Error deleting old link {item.id}: {e}")

            return transferred

        except Exception as e:
            logger.warning(f"Error transferring sources from {from_request_id} to {to_request_id}: {e}")
            return 0

    def add_source_links_batch(
        self,
        links: list[dict[str, str | bool]],
    ) -> int:
        """Add multiple source links in batch.

        Optimization for initial sync - avoid N individual API calls.
        Note: Each link still requires an API call, but this method provides
        consistent error handling and counting.

        Args:
            links: List of dicts with keys: bunk_request_id, original_request_id, is_primary

        Returns:
            Number of links successfully created
        """
        created = 0
        for link in links:
            if self.add_source_link(
                bunk_request_id=str(link["bunk_request_id"]),
                original_request_id=str(link["original_request_id"]),
                is_primary=bool(link.get("is_primary", False)),
                source_field=str(link.get("source_field")) if link.get("source_field") else None,
            ):
                created += 1
        return created

    def get_sources_for_requests_batch(
        self,
        bunk_request_ids: list[str],
    ) -> dict[str, list[str]]:
        """Get sources for multiple requests at once.

        Optimization for partial invalidation checks.

        Args:
            bunk_request_ids: List of bunk_request IDs to look up

        Returns:
            Dict mapping bunk_request_id to list of original_request_ids
        """
        if not bunk_request_ids:
            return {}

        try:
            # Build OR filter for all request IDs
            id_conditions = [f'bunk_request = "{rid}"' for rid in bunk_request_ids]
            filter_str = "(" + " || ".join(id_conditions) + ")"

            result = self.pb.collection(COLLECTION_NAME).get_list(
                query_params={"filter": filter_str, "perPage": 500}
            )

            # Group by bunk_request
            sources_map: dict[str, list[str]] = defaultdict(list)
            for item in result.items:
                sources_map[item.bunk_request].append(item.original_request)

            return dict(sources_map)

        except Exception as e:
            logger.warning(f"Error getting sources batch: {e}")
            return {}
