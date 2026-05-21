"""Tests for RBAC permission gating on all FastAPI router endpoints.

Verifies that each router endpoint requires the correct permission dependency.
Uses FastAPI's dependency_overrides to test permission enforcement without
needing to mock PocketBase or auth middleware.
"""

import inspect

import pytest

from bunking.auth_middleware import AuthUser, get_current_user
from bunking.rbac.dependencies import require_admin
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
    """social_graph.py read endpoints require authentication; write endpoints require bunking.manage."""

    def test_session_graph_requires_authentication(self) -> None:
        """GET /api/sessions/{id}/social-graph needs authentication."""
        from api.routers.social_graph import get_session_social_graph

        _assert_endpoint_has_auth_dep(get_session_social_graph)

    def test_bunk_graph_requires_authentication(self) -> None:
        """GET /api/bunks/{id}/social-graph needs authentication."""
        from api.routers.social_graph import get_bunk_social_graph

        _assert_endpoint_has_auth_dep(get_bunk_social_graph)

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
    """metrics.py read endpoints require authentication."""

    def test_retention_requires_authentication(self) -> None:
        from api.routers.metrics import get_retention_metrics

        _assert_endpoint_has_auth_dep(get_retention_metrics)

    def test_registration_requires_authentication(self) -> None:
        from api.routers.metrics import get_registration_metrics

        _assert_endpoint_has_auth_dep(get_registration_metrics)

    def test_comparison_requires_authentication(self) -> None:
        from api.routers.metrics import get_comparison_metrics

        _assert_endpoint_has_auth_dep(get_comparison_metrics)

    def test_historical_requires_authentication(self) -> None:
        from api.routers.metrics import get_historical_trends

        _assert_endpoint_has_auth_dep(get_historical_trends)

    def test_retention_trends_requires_authentication(self) -> None:
        from api.routers.metrics import get_retention_trends

        _assert_endpoint_has_auth_dep(get_retention_trends)

    def test_waitlist_requires_authentication(self) -> None:
        from api.routers.metrics import get_waitlist_metrics

        _assert_endpoint_has_auth_dep(get_waitlist_metrics)

    def test_cancellations_requires_authentication(self) -> None:
        from api.routers.metrics import get_cancellation_metrics

        _assert_endpoint_has_auth_dep(get_cancellation_metrics)

    def test_drilldown_requires_authentication(self) -> None:
        from api.routers.metrics import get_drilldown_attendees

        _assert_endpoint_has_auth_dep(get_drilldown_attendees)

    def test_velocity_requires_authentication(self) -> None:
        from api.routers.metrics import get_velocity

        _assert_endpoint_has_auth_dep(get_velocity)

    def test_forecast_requires_authentication(self) -> None:
        from api.routers.metrics import get_forecast

        _assert_endpoint_has_auth_dep(get_forecast)

    def test_cache_invalidate_has_no_endpoint_auth(self) -> None:
        """Cache invalidation has no endpoint-level auth dep (middleware bypass)."""
        from api.routers.metrics import invalidate_metrics_cache

        assert _get_dependency(invalidate_metrics_cache) is None

    def test_cache_stats_requires_authentication(self) -> None:
        from api.routers.metrics import get_cache_stats

        _assert_endpoint_has_auth_dep(get_cache_stats)


class TestSessionAvailabilityPermissions:
    """session_availability.py endpoints require authentication."""

    def test_session_availability_requires_authentication(self) -> None:
        from api.routers.session_availability import get_session_availability

        _assert_endpoint_has_auth_dep(get_session_availability)


class TestGeoPermissions:
    """geo.py endpoints require metrics.geo."""

    def test_get_gaps_requires_metrics_geo(self) -> None:
        from api.routers.geo import get_gaps

        _assert_endpoint_has_permission_dep(get_gaps, Permission.METRICS_GEO)

    def test_search_canonicals_requires_metrics_geo(self) -> None:
        from api.routers.geo import search_canonicals

        _assert_endpoint_has_permission_dep(search_canonicals, Permission.METRICS_GEO)

    def test_get_sources_requires_metrics_geo(self) -> None:
        from api.routers.geo import get_sources

        _assert_endpoint_has_permission_dep(get_sources, Permission.METRICS_GEO)

    def test_batch_resolve_coords_requires_metrics_geo(self) -> None:
        from api.routers.geo import batch_resolve_coords

        _assert_endpoint_has_permission_dep(batch_resolve_coords, Permission.METRICS_GEO)

    def test_list_overrides_requires_metrics_geo(self) -> None:
        from api.routers.geo import list_overrides

        _assert_endpoint_has_permission_dep(list_overrides, Permission.METRICS_GEO)

    def test_create_override_requires_metrics_geo(self) -> None:
        from api.routers.geo import create_override

        _assert_endpoint_has_permission_dep(create_override, Permission.METRICS_GEO)

    def test_update_override_requires_metrics_geo(self) -> None:
        from api.routers.geo import update_override

        _assert_endpoint_has_permission_dep(update_override, Permission.METRICS_GEO)

    def test_delete_override_requires_metrics_geo(self) -> None:
        from api.routers.geo import delete_override

        _assert_endpoint_has_permission_dep(delete_override, Permission.METRICS_GEO)


class TestDebugPermissions:
    """debug.py endpoints require admin (admin-level debug tools)."""

    def test_list_parse_analysis_requires_admin(self) -> None:
        from api.routers.debug import list_parse_analysis

        _assert_endpoint_has_admin_dep(list_parse_analysis)

    def test_get_parse_analysis_detail_requires_admin(self) -> None:
        from api.routers.debug import get_parse_analysis_detail

        _assert_endpoint_has_admin_dep(get_parse_analysis_detail)

    def test_parse_phase1_only_requires_admin(self) -> None:
        from api.routers.debug import parse_phase1_only

        _assert_endpoint_has_admin_dep(parse_phase1_only)

    def test_clear_single_parse_analysis_requires_admin(self) -> None:
        from api.routers.debug import clear_single_parse_analysis

        _assert_endpoint_has_admin_dep(clear_single_parse_analysis)

    def test_clear_parse_analysis_requires_admin(self) -> None:
        from api.routers.debug import clear_parse_analysis

        _assert_endpoint_has_admin_dep(clear_parse_analysis)

    def test_list_original_requests_requires_admin(self) -> None:
        from api.routers.debug import list_original_requests

        _assert_endpoint_has_admin_dep(list_original_requests)

    def test_list_original_requests_with_parse_status_requires_admin(self) -> None:
        from api.routers.debug import list_original_requests_with_parse_status

        _assert_endpoint_has_admin_dep(list_original_requests_with_parse_status)

    def test_list_original_requests_grouped_requires_admin(self) -> None:
        from api.routers.debug import list_original_requests_grouped

        _assert_endpoint_has_admin_dep(list_original_requests_grouped)

    def test_get_parse_results_batch_requires_admin(self) -> None:
        from api.routers.debug import get_parse_results_batch

        _assert_endpoint_has_admin_dep(get_parse_results_batch)

    def test_get_parse_results_batch_dual_requires_admin(self) -> None:
        from api.routers.debug import get_parse_results_batch_dual

        _assert_endpoint_has_admin_dep(get_parse_results_batch_dual)

    def test_get_parse_result_with_fallback_requires_admin(self) -> None:
        from api.routers.debug import get_parse_result_with_fallback

        _assert_endpoint_has_admin_dep(get_parse_result_with_fallback)

    def test_list_prompts_requires_admin(self) -> None:
        from api.routers.debug import list_prompts

        _assert_endpoint_has_admin_dep(list_prompts)

    def test_get_prompt_requires_admin(self) -> None:
        from api.routers.debug import get_prompt

        _assert_endpoint_has_admin_dep(get_prompt)

    def test_update_prompt_requires_admin(self) -> None:
        from api.routers.debug import update_prompt

        _assert_endpoint_has_admin_dep(update_prompt)

    def test_get_production_requests_requires_admin(self) -> None:
        from api.routers.debug import get_production_requests

        _assert_endpoint_has_admin_dep(get_production_requests)


# ============================================================================
# Helper: Introspect endpoint function signature for permission dependency
# ============================================================================


def _get_dependency(endpoint_func: object) -> object | None:
    """Extract the FastAPI dependency from an endpoint function's signature."""
    sig = inspect.signature(endpoint_func)  # type: ignore[arg-type]
    for param in sig.parameters.values():
        default = param.default
        if hasattr(default, "dependency"):
            dep: object = default.dependency
            return dep
    return None


def _assert_endpoint_has_permission_dep(endpoint_func: object, expected_permission: str) -> None:
    """Assert that an endpoint has a require_permission dependency for the given permission."""
    dep = _get_dependency(endpoint_func)
    if callable(dep) and hasattr(dep, "__closure__") and dep.__closure__:
        for cell in dep.__closure__:
            try:
                if cell.cell_contents == expected_permission:
                    return
            except ValueError:
                continue

    pytest.fail(
        f"Endpoint {getattr(endpoint_func, '__name__', endpoint_func)} does not have "
        f'Depends(require_permission("{expected_permission}")) in its signature'
    )


def _assert_endpoint_has_auth_dep(endpoint_func: object) -> None:
    """Assert that an endpoint has a get_current_user dependency."""
    if _get_dependency(endpoint_func) is get_current_user:
        return
    pytest.fail(
        f"Endpoint {getattr(endpoint_func, '__name__', endpoint_func)} does not have "
        f"Depends(get_current_user) in its signature"
    )


def _assert_endpoint_has_admin_dep(endpoint_func: object) -> None:
    """Assert that an endpoint has a require_admin dependency."""
    if _get_dependency(endpoint_func) is require_admin:
        return
    pytest.fail(
        f"Endpoint {getattr(endpoint_func, '__name__', endpoint_func)} does not have "
        f"Depends(require_admin) in its signature"
    )
