from __future__ import annotations

#!/usr/bin/env python3
"""
Test NetworkX-based friend group detection
"""
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from pocketbase import PocketBase

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from bunking.graph.social_graph_builder import SocialGraphBuilder

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def main():
    """Test NetworkX friend group detection"""
    # Initialize PocketBase
    pb = PocketBase("http://localhost:8090")
    pb.collection("_superusers").auth_with_password(
        os.getenv("POCKETBASE_ADMIN_EMAIL", "admin@camp.local"),
        os.getenv("POCKETBASE_ADMIN_PASSWORD", "campbunking123"),
    )

    # Get current year
    current_year = 2025

    # Get all sessions for current year
    sessions = pb.collection("camp_sessions").get_full_list(query_params={"filter": f"year = {current_year}"})

    if not sessions:
        logger.error("No sessions found for current year")
        return

    # Test with first session
    session = sessions[0]
    logger.info(f"Testing with session: {session.name} (ID: {session.campminder_id})")  # type: ignore[attr-defined]

    # Build social graph
    logger.info("Building social graph...")
    graph_builder = SocialGraphBuilder(pb)
    graph_builder.build_session_graph(current_year, session.campminder_id)  # type: ignore[attr-defined]

    # Get graph metrics
    metrics = graph_builder.get_graph_metrics()
    logger.info("Graph metrics:")
    for key, value in metrics.items():
        logger.info(f"  {key}: {value}")

    # Detect friend groups
    logger.info("\nDetecting friend groups...")
    detections = graph_builder.detect_friend_groups(
        min_size=3, max_size=8, ignore_threshold=0.40, manual_threshold=0.50, auto_threshold=0.75
    )

    logger.info(f"\nFound {len(detections)} friend groups:")

    for i, detection in enumerate(detections[:10]):  # Show first 10
        logger.info(f"\nGroup {i + 1}:")
        logger.info(f"  Members: {detection.members}")
        logger.info(f"  Cohesion: {detection.cohesion_score:.2%}")
        logger.info(f"  Method: {detection.detection_method}")
        logger.info(f"  Edge members: {len(detection.edge_members)}")
        logger.info(f"  Missing connections: {len(detection.missing_connections)}")
        logger.info(f"  Recommendation: {detection.recommendation}")

        # Get member names
        member_names = []
        for member_id in detection.members[:5]:  # First 5 members
            try:
                person = pb.collection("persons").get_first_list_item(f"campminder_id={member_id}")
                member_names.append(person.name)
            except Exception:
                member_names.append(f"ID:{member_id}")

        if len(detection.members) > 5:
            member_names.append(f"... and {len(detection.members) - 5} more")

        logger.info(f"  Names: {', '.join(member_names)}")

    # Find isolated campers
    isolated = graph_builder.find_isolated_campers(threshold=1)
    logger.info(f"\nFound {len(isolated)} isolated campers (≤1 connection)")

    # Find bridge campers
    bridges = graph_builder.find_bridge_campers()
    logger.info(f"Found {len(bridges)} bridge campers (connect multiple groups)")

    logger.info("\nNetworkX friend group detection test complete!")


if __name__ == "__main__":
    main()
