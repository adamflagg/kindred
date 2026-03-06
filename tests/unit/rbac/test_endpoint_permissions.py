"""Tests for RBAC permission gating on all FastAPI router endpoints.

Verifies that each router endpoint requires the correct permission dependency.
Uses FastAPI's dependency_overrides to test permission enforcement without
needing to mock PocketBase or auth middleware.
"""

from __future__ import annotations

import pytest
from fastapi import Depends

from bunking.auth_middleware import AuthUser
from bunking.rbac.permissions import Permission


def _make_user(permissions: set[str] | None = None, is_admin: bool = False) -> AuthUser:
    """Create a test AuthUser with given permissions."""
    user = AuthUser(
        username="testuser",
        email="test@example.com",
        display_name="Test User",
        groups=["staff"],
        is_admin=is_admin,
    )
    user.permissions = permissions or set()
    return user


class TestSocialGraphPermissions:
    """social_graph.py endpoints require bunking.view."""

    def test_session_graph_requires_bunking_view(self) -> None:
        """GET /api/sessions/{id}/social-graph needs bunking.view."""
        from api.routers.social_graph import get_session_social_graph

        _assert_endpoint_has_permission_dep(get_session_social_graph, Permission.BUNKING_VIEW)

    def test_bunk_graph_requires_bunking_view(self) -> None:
        """GET /api/bunks/{id}/social-graph needs bunking.view."""
        from api.routers.social_graph import get_bunk_social_graph

        _assert_endpoint_has_permission_dep(get_bunk_social_graph, Permission.BUNKING_VIEW)

    def test_ego_network_requires_bunking_view(self) -> None:
        """GET /api/persons/{id}/ego-network needs bunking.view."""
        from api.routers.social_graph import get_person_ego_network

        _assert_endpoint_has_permission_dep(get_person_ego_network, Permission.BUNKING_VIEW)

    def test_update_position_requires_bunking_manage(self) -> None:
        """PATCH /api/sessions/{id}/campers/{id}/position needs bunking.manage."""
        from api.routers.social_graph import update_camper_position

        _assert_endpoint_has_permission_dep(update_camper_position, Permission.BUNKING_MANAGE)


class TestSolverPermissions:
    """solver.py endpoints require bunking.manage."""

    def test_run_solver_requires_bunking_manage(self) -> None:
        from api.routers.solver import run_solver

        _assert_endpoint_has_permission_dep(run_solver, Permission.BUNKING_MANAGE)

    def test_get_solver_run_requires_bunking_manage(self) -> None:
        from api.routers.solver import get_solver_run

        _assert_endpoint_has_permission_dep(get_solver_run, Permission.BUNKING_MANAGE)

    def test_pre_validate_requires_bunking_manage(self) -> None:
        from api.routers.solver import pre_validate_solver

        _assert_endpoint_has_permission_dep(pre_validate_solver, Permission.BUNKING_MANAGE)

    def test_analyze_solver_run_requires_bunking_manage(self) -> None:
        from api.routers.solver import analyze_solver_run

        _assert_endpoint_has_permission_dep(analyze_solver_run, Permission.BUNKING_MANAGE)

    def test_apply_solver_results_requires_bunking_manage(self) -> None:
        from api.routers.solver import apply_solver_results

        _assert_endpoint_has_permission_dep(apply_solver_results, Permission.BUNKING_MANAGE)

    def test_run_multi_session_requires_bunking_manage(self) -> None:
        from api.routers.solver import run_multi_session_solver

        _assert_endpoint_has_permission_dep(run_multi_session_solver, Permission.BUNKING_MANAGE)

    def test_clear_assignments_requires_bunking_manage(self) -> None:
        from api.routers.solver import clear_session_assignments

        _assert_endpoint_has_permission_dep(clear_session_assignments, Permission.BUNKING_MANAGE)

    def test_get_solver_logs_requires_bunking_manage(self) -> None:
        from api.routers.solver import get_solver_logs

        _assert_endpoint_has_permission_dep(get_solver_logs, Permission.BUNKING_MANAGE)

    def test_list_solver_logs_requires_bunking_manage(self) -> None:
        from api.routers.solver import list_solver_logs

        _assert_endpoint_has_permission_dep(list_solver_logs, Permission.BUNKING_MANAGE)


class TestScenariosPermissions:
    """scenarios.py endpoints require bunking.manage."""

    def test_create_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import create_scenario

        _assert_endpoint_has_permission_dep(create_scenario, Permission.BUNKING_MANAGE)

    def test_list_scenarios_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import list_scenarios

        _assert_endpoint_has_permission_dep(list_scenarios, Permission.BUNKING_MANAGE)

    def test_evaluate_score_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import evaluate_score

        _assert_endpoint_has_permission_dep(evaluate_score, Permission.BUNKING_MANAGE)

    def test_get_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import get_scenario

        _assert_endpoint_has_permission_dep(get_scenario, Permission.BUNKING_MANAGE)

    def test_update_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import update_scenario

        _assert_endpoint_has_permission_dep(update_scenario, Permission.BUNKING_MANAGE)

    def test_delete_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import delete_scenario

        _assert_endpoint_has_permission_dep(delete_scenario, Permission.BUNKING_MANAGE)

    def test_update_assignment_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import update_scenario_assignment

        _assert_endpoint_has_permission_dep(update_scenario_assignment, Permission.BUNKING_MANAGE)

    def test_analyze_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import analyze_scenario

        _assert_endpoint_has_permission_dep(analyze_scenario, Permission.BUNKING_MANAGE)

    def test_solve_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import solve_scenario

        _assert_endpoint_has_permission_dep(solve_scenario, Permission.BUNKING_MANAGE)

    def test_clear_scenario_requires_bunking_manage(self) -> None:
        from api.routers.scenarios import clear_scenario

        _assert_endpoint_has_permission_dep(clear_scenario, Permission.BUNKING_MANAGE)


class TestRequestsPermissions:
    """requests.py endpoints require bunking.manage."""

    def test_merge_requests_requires_bunking_manage(self) -> None:
        from api.routers.requests import merge_requests

        _assert_endpoint_has_permission_dep(merge_requests, Permission.BUNKING_MANAGE)

    def test_split_requests_requires_bunking_manage(self) -> None:
        from api.routers.requests import split_requests

        _assert_endpoint_has_permission_dep(split_requests, Permission.BUNKING_MANAGE)


class TestValidationPermissions:
    """validation.py endpoints require bunking.manage."""

    def test_validate_bunking_requires_bunking_manage(self) -> None:
        from api.routers.validation import validate_bunking

        _assert_endpoint_has_permission_dep(validate_bunking, Permission.BUNKING_MANAGE)


class TestMetricsPermissions:
    """metrics.py endpoints require metrics.view, except forecast which needs metrics.financial."""

    def test_retention_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_retention_metrics

        _assert_endpoint_has_permission_dep(get_retention_metrics, Permission.METRICS_VIEW)

    def test_registration_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_registration_metrics

        _assert_endpoint_has_permission_dep(get_registration_metrics, Permission.METRICS_VIEW)

    def test_comparison_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_comparison_metrics

        _assert_endpoint_has_permission_dep(get_comparison_metrics, Permission.METRICS_VIEW)

    def test_historical_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_historical_trends

        _assert_endpoint_has_permission_dep(get_historical_trends, Permission.METRICS_VIEW)

    def test_retention_trends_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_retention_trends

        _assert_endpoint_has_permission_dep(get_retention_trends, Permission.METRICS_VIEW)

    def test_waitlist_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_waitlist_metrics

        _assert_endpoint_has_permission_dep(get_waitlist_metrics, Permission.METRICS_VIEW)

    def test_cancellations_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_cancellation_metrics

        _assert_endpoint_has_permission_dep(get_cancellation_metrics, Permission.METRICS_VIEW)

    def test_drilldown_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_drilldown_attendees

        _assert_endpoint_has_permission_dep(get_drilldown_attendees, Permission.METRICS_VIEW)

    def test_velocity_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_velocity

        _assert_endpoint_has_permission_dep(get_velocity, Permission.METRICS_VIEW)

    def test_forecast_requires_metrics_financial(self) -> None:
        from api.routers.metrics import get_forecast

        _assert_endpoint_has_permission_dep(get_forecast, Permission.METRICS_FINANCIAL)

    def test_cache_invalidate_requires_metrics_view(self) -> None:
        from api.routers.metrics import invalidate_metrics_cache

        _assert_endpoint_has_permission_dep(invalidate_metrics_cache, Permission.METRICS_VIEW)

    def test_cache_stats_requires_metrics_view(self) -> None:
        from api.routers.metrics import get_cache_stats

        _assert_endpoint_has_permission_dep(get_cache_stats, Permission.METRICS_VIEW)


class TestSessionAvailabilityPermissions:
    """session_availability.py endpoints require metrics.view."""

    def test_session_availability_requires_metrics_view(self) -> None:
        from api.routers.session_availability import get_session_availability

        _assert_endpoint_has_permission_dep(get_session_availability, Permission.METRICS_VIEW)


class TestDebugPermissions:
    """debug.py endpoints require users.manage (admin-level debug tools)."""

    def test_list_parse_analysis_requires_users_manage(self) -> None:
        from api.routers.debug import list_parse_analysis

        _assert_endpoint_has_permission_dep(list_parse_analysis, Permission.USERS_MANAGE)

    def test_get_parse_analysis_detail_requires_users_manage(self) -> None:
        from api.routers.debug import get_parse_analysis_detail

        _assert_endpoint_has_permission_dep(get_parse_analysis_detail, Permission.USERS_MANAGE)

    def test_parse_phase1_only_requires_users_manage(self) -> None:
        from api.routers.debug import parse_phase1_only

        _assert_endpoint_has_permission_dep(parse_phase1_only, Permission.USERS_MANAGE)

    def test_clear_single_parse_analysis_requires_users_manage(self) -> None:
        from api.routers.debug import clear_single_parse_analysis

        _assert_endpoint_has_permission_dep(clear_single_parse_analysis, Permission.USERS_MANAGE)

    def test_clear_parse_analysis_requires_users_manage(self) -> None:
        from api.routers.debug import clear_parse_analysis

        _assert_endpoint_has_permission_dep(clear_parse_analysis, Permission.USERS_MANAGE)

    def test_list_original_requests_requires_users_manage(self) -> None:
        from api.routers.debug import list_original_requests

        _assert_endpoint_has_permission_dep(list_original_requests, Permission.USERS_MANAGE)

    def test_list_original_requests_with_parse_status_requires_users_manage(self) -> None:
        from api.routers.debug import list_original_requests_with_parse_status

        _assert_endpoint_has_permission_dep(list_original_requests_with_parse_status, Permission.USERS_MANAGE)

    def test_list_original_requests_grouped_requires_users_manage(self) -> None:
        from api.routers.debug import list_original_requests_grouped

        _assert_endpoint_has_permission_dep(list_original_requests_grouped, Permission.USERS_MANAGE)

    def test_get_parse_results_batch_requires_users_manage(self) -> None:
        from api.routers.debug import get_parse_results_batch

        _assert_endpoint_has_permission_dep(get_parse_results_batch, Permission.USERS_MANAGE)

    def test_get_parse_results_batch_dual_requires_users_manage(self) -> None:
        from api.routers.debug import get_parse_results_batch_dual

        _assert_endpoint_has_permission_dep(get_parse_results_batch_dual, Permission.USERS_MANAGE)

    def test_get_parse_result_with_fallback_requires_users_manage(self) -> None:
        from api.routers.debug import get_parse_result_with_fallback

        _assert_endpoint_has_permission_dep(get_parse_result_with_fallback, Permission.USERS_MANAGE)

    def test_list_prompts_requires_users_manage(self) -> None:
        from api.routers.debug import list_prompts

        _assert_endpoint_has_permission_dep(list_prompts, Permission.USERS_MANAGE)

    def test_get_prompt_requires_users_manage(self) -> None:
        from api.routers.debug import get_prompt

        _assert_endpoint_has_permission_dep(get_prompt, Permission.USERS_MANAGE)

    def test_update_prompt_requires_users_manage(self) -> None:
        from api.routers.debug import update_prompt

        _assert_endpoint_has_permission_dep(update_prompt, Permission.USERS_MANAGE)

    def test_get_production_requests_requires_users_manage(self) -> None:
        from api.routers.debug import get_production_requests

        _assert_endpoint_has_permission_dep(get_production_requests, Permission.USERS_MANAGE)


# ============================================================================
# Helper: Introspect endpoint function signature for permission dependency
# ============================================================================


def _assert_endpoint_has_permission_dep(endpoint_func: object, expected_permission: str) -> None:
    """Assert that an endpoint function has a require_permission dependency for the given permission.

    Inspects the function's type annotations and default values to find a
    Depends(require_permission("...")) parameter matching the expected permission.
    """
    import inspect

    sig = inspect.signature(endpoint_func)  # type: ignore[arg-type]

    for param in sig.parameters.values():
        default = param.default
        if not isinstance(default, Depends.__class__):
            # Check if it's a fastapi.params.Depends instance
            if hasattr(default, "dependency"):
                dep = default.dependency
                # The dependency should be a closure from require_permission()
                # Check if it's a function with the right closure variables
                if callable(dep) and hasattr(dep, "__closure__") and dep.__closure__:
                    for cell in dep.__closure__:
                        try:
                            cell_value = cell.cell_contents
                            if cell_value == expected_permission:
                                return  # Found the correct permission
                        except ValueError:
                            continue

    pytest.fail(
        f"Endpoint {getattr(endpoint_func, '__name__', endpoint_func)} does not have "
        f'Depends(require_permission("{expected_permission}")) in its signature'
    )
