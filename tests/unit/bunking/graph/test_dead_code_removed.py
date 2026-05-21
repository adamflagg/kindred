"""Verify legacy/dead methods on SocialGraphBuilder are removed.

Issue #1062: ``SocialGraphBuilder.build_session_graph`` and ``_bundle_edges``
were the legacy code path. ``OptimizedSocialGraphBuilder.build_social_network``
is the only production caller, and it does not invoke ``_bundle_edges``.
``SocialGraphBuilder.build_bunk_graph`` (which IS still alive via inheritance)
does not depend on ``_bundle_edges`` either.

These tests pin the cleanup so the dead methods cannot reappear.
"""

from unittest.mock import MagicMock

from bunking.graph.optimized_graph_builder import OptimizedSocialGraphBuilder
from bunking.graph.social_graph_builder import SocialGraphBuilder


class TestDeadMethodsRemoved:
    """The legacy build_session_graph and _bundle_edges must be deleted."""

    def test_build_session_graph_removed_from_parent(self) -> None:
        """SocialGraphBuilder.build_session_graph (legacy) must not exist."""
        assert not hasattr(SocialGraphBuilder, "build_session_graph"), (
            "SocialGraphBuilder.build_session_graph is the legacy unreachable "
            "method (#1062). It must be deleted; production uses "
            "OptimizedSocialGraphBuilder.build_social_network instead."
        )

    def test_bundle_edges_removed(self) -> None:
        """_bundle_edges was only called from the dead build_session_graph path."""
        assert not hasattr(SocialGraphBuilder, "_bundle_edges"), (
            "SocialGraphBuilder._bundle_edges is orphaned after build_session_graph "
            "deletion (#1062). It must be removed."
        )
        # Optimized inherits, so check there too for completeness.
        assert not hasattr(OptimizedSocialGraphBuilder, "_bundle_edges"), (
            "_bundle_edges must not be inherited by OptimizedSocialGraphBuilder."
        )


class TestLiveMethodsPreserved:
    """The cleanup must NOT remove methods that production still uses."""

    def test_build_bunk_graph_still_exists(self) -> None:
        """build_bunk_graph is alive — used by /api/bunk-graph/... router."""
        assert hasattr(SocialGraphBuilder, "build_bunk_graph"), (
            "build_bunk_graph must survive the cleanup; routers depend on it."
        )

    def test_build_social_network_override_still_exists(self) -> None:
        """OptimizedSocialGraphBuilder.build_social_network is the live path."""
        assert hasattr(OptimizedSocialGraphBuilder, "build_social_network"), (
            "build_social_network override on Optimized is the production path."
        )

    def test_calculate_node_metrics_still_exists(self) -> None:
        """build_bunk_graph and the optimized builder both call _calculate_node_metrics."""
        assert hasattr(SocialGraphBuilder, "_calculate_node_metrics"), (
            "_calculate_node_metrics is used by build_bunk_graph and Optimized."
        )

    def test_add_request_edges_still_exists(self) -> None:
        """_add_request_edges is exercised by satisfaction tests directly."""
        assert hasattr(SocialGraphBuilder, "_add_request_edges")

    def test_add_camper_nodes_still_exists(self) -> None:
        """_add_camper_nodes is a helper used internally and by tests."""
        assert hasattr(SocialGraphBuilder, "_add_camper_nodes")


class TestBuildBunkGraphIndependentOfBundleEdges:
    """Sanity check: build_bunk_graph must not silently call a removed method."""

    def test_build_bunk_graph_does_not_invoke_bundle_edges(self) -> None:
        """build_bunk_graph runs to completion with empty data without
        needing _bundle_edges. We mock the PocketBase client so the empty
        path returns early after the bunk-members lookup."""
        pb = MagicMock()
        # No assignments → empty bunk_members → early return after AG check.
        pb.collection.return_value.get_full_list.return_value = []
        pb.collection.return_value.get_first_list_item.side_effect = Exception("no bunk")

        builder = SocialGraphBuilder(pb)
        # If build_bunk_graph somehow depended on _bundle_edges (it shouldn't),
        # this would raise AttributeError after the cleanup. The empty path
        # exercises the early-return branch but still touches enough of the
        # method body that any direct call to _bundle_edges would surface.
        graph = builder.build_bunk_graph(year=2026, bunk_cm_id=1, session_cm_id=1)
        assert graph.number_of_nodes() == 0
