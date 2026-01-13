#!/usr/bin/env python3
"""
Sync sibling relationships based on shared FamilyID
"""

from __future__ import annotations

import logging
import os
import sys
from collections import defaultdict
from typing import Any

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from bunking.sync.base_sync import BaseSyncService
from campminder.client import CampMinderClient

logger = logging.getLogger(__name__)


class SiblingRelationshipsSyncService(BaseSyncService):
    """Sync service to create sibling relationships based on FamilyID."""

    # Declare attributes that are accessed but not defined in base class
    stats: dict[str, int]
    cm_client: CampMinderClient

    def __init__(self) -> None:
        super().__init__()
        self.family_groups: defaultdict[int, list[Any]] = defaultdict(list)  # FamilyID -> List of person records
        self.stats = {"created": 0, "skipped": 0, "errors": 0}

    def _rate_limit(self) -> None:
        """Rate limit helper for CampMinder API calls."""
        import time

        time.sleep(0.1)  # Simple rate limiting

    def print_summary(self) -> None:
        """Print sync summary."""
        logger.info("=== Sync Summary ===")
        for key, value in self.stats.items():
            logger.info(f"  {key}: {value}")

    def build_family_groups(self) -> None:
        """Build groups of persons who share the same FamilyID."""
        logger.info("Building family groups from persons with FamilyID...")

        # Get all persons with a family_id
        page = 1
        per_page = 500

        while True:
            persons = self.pb.collection("persons").get_list(
                page=page, per_page=per_page, query_params={"filter": "family_id > 0"}
            )

            for person in persons.items:
                if hasattr(person, "family_id") and person.family_id:
                    self.family_groups[person.family_id].append(person)

            logger.info(f"Processed page {page} ({len(persons.items)} persons)")

            if len(persons.items) < per_page:
                break
            page += 1

        # Log family statistics
        families_with_siblings = sum(1 for members in self.family_groups.values() if len(members) > 1)
        logger.info(f"Found {len(self.family_groups)} families total")
        logger.info(f"Found {families_with_siblings} families with multiple children")

        # Show some examples
        for family_id, members in list(self.family_groups.items())[:5]:
            if len(members) > 1:
                names = [f"{getattr(p, 'first_name', '')} {getattr(p, 'last_name', '')}" for p in members]
                logger.info(f"  Family {family_id}: {', '.join(names)}")

    def sync_sibling_relationships(self) -> None:
        """Create sibling relationships for all persons in the same family."""
        logger.info("Creating sibling relationships...")

        created = 0
        skipped = 0
        errors = 0

        for family_id, members in self.family_groups.items():
            if len(members) < 2:
                continue  # No siblings if only one child

            # Create relationships between all pairs
            for i, person1 in enumerate(members):
                for person2 in members[i + 1 :]:
                    try:
                        # Check if relationship already exists (in either direction)
                        existing = self.pb.collection("person_relatives").get_list(
                            1,
                            1,
                            query_params={
                                "filter": f'(person="{person1.id}" && relative="{person2.id}") || (person="{person2.id}" && relative="{person1.id}")'
                            },
                        )

                        if not existing.items:
                            # Create bidirectional sibling relationships
                            # Person1 -> Person2
                            self.pb.collection("person_relatives").create(
                                {
                                    "person": person1.id,
                                    "relative": person2.id,
                                    "relationship_type": "Sibling",
                                }
                            )

                            # Person2 -> Person1
                            self.pb.collection("person_relatives").create(
                                {
                                    "person": person2.id,
                                    "relative": person1.id,
                                    "relationship_type": "Sibling",
                                }
                            )

                            created += 2
                            logger.debug(
                                f"Created sibling relationship: {getattr(person1, 'first_name', '')} {getattr(person1, 'last_name', '')} <-> {getattr(person2, 'first_name', '')} {getattr(person2, 'last_name', '')}"
                            )
                        else:
                            skipped += 2

                    except Exception as e:
                        logger.error(f"Error creating sibling relationship for family {family_id}: {e}")
                        errors += 1

        logger.info(f"Created {created} sibling relationships")
        logger.info(f"Skipped {skipped} existing relationships")
        logger.info(f"Errors: {errors}")

        self.stats["created"] = created
        self.stats["skipped"] = skipped
        self.stats["errors"] = errors

    def sync_family_ids_from_campminder(self) -> int:
        """First sync FamilyID from CampMinder to persons table."""
        logger.info("Syncing FamilyID from CampMinder...")

        # Get all persons
        page = 1
        per_page = 100
        updated = 0

        while True:
            persons = self.pb.collection("persons").get_list(
                page=page, per_page=per_page, query_params={"filter": "campminder_person_id > 0"}
            )

            if not persons.items:
                break

            # Collect CampMinder IDs for batch fetch
            cm_ids = [getattr(p, "campminder_person_id", None) for p in persons.items]

            # Fetch from CampMinder with family data
            params: dict[str, Any] = {
                "clientid": self.cm_client.config.client_id,
                "seasonid": self.cm_client.config.season_id,
                "pagenumber": 1,
                "pagesize": len(cm_ids),
                "includefamilypersons": "true",
                "id": [],
            }

            # Add each ID
            for cm_id in cm_ids:
                params["id"].append(str(cm_id))

            self._rate_limit()
            response = self.cm_client._make_request("GET", "persons", params=params)

            if response and "Results" in response:
                # Create lookup map
                cm_data_map = {p["ID"]: p for p in response["Results"]}

                # Update each person with FamilyID
                for person in persons.items:
                    cm_data = cm_data_map.get(getattr(person, "campminder_person_id", None))
                    if cm_data:
                        family_persons = cm_data.get("FamilyPersons", [])
                        if family_persons and len(family_persons) > 0:
                            family_id = family_persons[0].get("FamilyID")
                            if family_id and (not hasattr(person, "family_id") or person.family_id != family_id):
                                try:
                                    self.pb.collection("persons").update(person.id, {"family_id": family_id})
                                    updated += 1
                                except Exception as e:
                                    logger.error(f"Error updating family_id for {person.id}: {e}")

            logger.info(f"Processed page {page} ({len(persons.items)} persons, {updated} updated so far)")

            if len(persons.items) < per_page:
                break
            page += 1

        logger.info(f"Updated {updated} persons with FamilyID")
        return updated

    def sync(self) -> None:
        """Main sync process."""
        logger.info("=== Starting Sibling Relationships Sync ===")

        # First ensure we have FamilyID data
        logger.info("Step 1: Syncing FamilyID from CampMinder...")
        self.sync_family_ids_from_campminder()

        # Build family groups
        logger.info("\nStep 2: Building family groups...")
        self.build_family_groups()

        # Create sibling relationships
        logger.info("\nStep 3: Creating sibling relationships...")
        self.sync_sibling_relationships()

        # Print summary
        self.print_summary()
        logger.info("=== Sibling Relationships Sync Complete ===")


def main() -> None:
    """Main entry point."""
    try:
        sync_service = SiblingRelationshipsSyncService()
        sync_service.sync()
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
