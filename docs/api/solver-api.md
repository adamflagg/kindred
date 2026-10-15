# Solver Service API Documentation

## Overview

The Solver Service is the `kindred-api` FastAPI application. It provides constraint satisfaction solving for camp cabin assignments using Google OR-Tools CP-SAT, plus the scenario, validation and social-graph endpoints that go with it. It optimizes bunking arrangements while respecting the configured constraints and preferences.

**Base URL**: `http://localhost:8000` directly, or `http://localhost:8080` through Caddy. Every route below except `/health` lives under `/api/`. Caddy sends anything under `/api/*` that is not a PocketBase path to FastAPI (`api/CLAUDE.md`, "Routing").
**API Documentation**: `http://localhost:8000/docs` (Swagger UI) is the source of truth for the full route list. This page covers the solver, scenario, validation, request-merge, satisfaction and social-graph endpoints. Lodging, Camperships (`/api/aid/*`), metrics, geo, Jotform and debug routers have their own files under `api/routers/`.

## Authentication

Endpoints verify a PocketBase JWT (`bunking/auth_middleware.py`); the frontend sends it through `fetchWithAuth`. Solver, scenario, validation, satisfaction and request-merge endpoints require the `bunking.manage` permission (`Permission.BUNKING_MANAGE`, `require_permission(...)` in each router) and answer 401/403 otherwise. The social-graph reads only need a signed-in user, except that passing `scenario_id` also requires `bunking.manage`. `/health` is open.

## Core Concepts

### Solver Runs
- Asynchronous solving process identified by `run_id`
- Can check status and retrieve results later
- Configurable time limits (1-600 seconds, default 60)
- Production is **read-only** for the solver: a run, an apply, and a clear must all name a **scenario**, or they are refused with 422 (kindred#2467, #2473)

### Scenarios
- What-if planning for different bunking arrangements
- Copy from production, copy from another scenario, or start fresh
- Support for manual adjustments and locking
- A weekend (family or adult) session routes the same endpoints to the lodging draft tables instead of `bunk_assignments_draft`

### Assignments
- Map persons to bunks for a session
- Can be solver-generated or manual
- Support for "locked" assignments that solver respects
- Every request names a session by its CampMinder id **and a `year`**; CampMinder reuses session ids across years. The year the solver stamps on its output comes from `DirectSolverInput.year`, i.e. the request's `year`, not from the clock.

## API Endpoints

### Health Check

#### GET /health
Check service health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "kindred-api"
}
```

---

### Solver Operations

#### POST /api/solver/run
Start a new solver run for a session. Refused with 422 when `scenario` is missing or blank, and with 409 when a run for the same session is already pending or running.

**Request Body:**
```json
{
  "session_cm_id": 1000001,
  "year": 2025,
  "scenario": "scenario-pb-id",
  "apply_results": false,
  "time_limit": 60
}
```

**Parameters:**
- `session_cm_id` (required): CampMinder session ID to solve
- `year` (required): Camp year
- `scenario` (required in practice): PocketBase ID of the `saved_scenarios` record the results land in
- `apply_results` (optional, default=false): Auto-apply results to the run's scenario
- `time_limit` (optional, default=60): Max seconds to run (1-600)
- `respect_locks` (optional, default=true): Keep locked bunk assignments in place
- `locked_bunk_cm_ids` (optional): Bunk CM IDs to freeze during a partial re-solve
- `debug_constraints`, `debug_mode`, `config` (optional): Diagnostic and per-run config overrides

**Response:**
```json
{
  "run_id": "uuid-string",
  "status": "started",
  "message": "Solver run started in background"
}
```

**Status Codes:**
- 200: Solver run started successfully
- 409: A run for this session is already in progress (`in_progress_run_id` in the body)
- 422: Missing scenario or invalid parameters
- 500: Internal server error

---

#### GET /api/solver/run/{run_id}
Get status and results of a solver run. `status` is `pending`, `running`, `completed` or `failed`.

**Path Parameters:**
- `run_id`: The solver run identifier

**Response (Pending):**
```json
{
  "id": "uuid-string",
  "status": "pending",
  "results": null,
  "error_message": null,
  "overflow_used": 0,
  "break_glass_used": false,
  "infeasibility_cause": null,
  "localization": null,
  "impossibility_report": null
}
```

**Response (Completed):** `results.assignments` maps a person's CampMinder id to a bunk name; `stats` carries the solver statistics plus `assignments_changed` and `new_assignments`; `satisfied_requests` maps a person id to the request ids that were satisfied.
```json
{
  "id": "uuid-string",
  "status": "completed",
  "results": {
    "assignments": { "1000001": "B-1", "1000002": "B-1" },
    "stats": { "assignments_changed": 12, "new_assignments": 3 },
    "satisfied_requests": { "1000001": ["request-id"] }
  },
  "error_message": null,
  "overflow_used": 0,
  "break_glass_used": false,
  "infeasibility_cause": null,
  "localization": null,
  "impossibility_report": null
}
```

`overflow_used` is the number of bunks placed at the 13-seat overflow cap (0 on a clean 12-seat solve). `break_glass_used` is true when the request layer was relaxed to place everyone. `infeasibility_cause`, `localization` and `impossibility_report` are structured diagnostics, held in memory only; a run read back from PocketBase after a restart returns them as null.

**Response (Failed):**
```json
{
  "id": "uuid-string",
  "status": "failed",
  "results": null,
  "error_message": "No feasible solution found"
}
```

---

#### POST /api/solver/apply/{run_id}
Apply solver results to the run's **scenario** (`bunk_assignments_draft`).

⚠️ **Production is read-only for the solver.** A run carrying no scenario is refused with a 422 rather
than applied — see kindred#2467. The solver never writes `bunk_assignments`.

**Path Parameters:**
- `run_id`: The solver run identifier

**Response:**
```json
{
  "message": "Applied 148 assignments to bunk_assignments_draft"
}
```

**Status Codes:**
- 200: Results applied successfully
- 404: Run not found
- 400: Run not completed, or session id missing from the run
- 422: The run has no scenario

---

#### POST /api/solver/pre-validate
Check a solver request for impossible requests and capacity problems before running it. Takes the same body as `POST /api/solver/run`. Uses the same impossibility check as `DirectBunkingSolver._validate_requests`, so the two cannot drift.

**Response:** `{valid, errors, warnings, statistics, impossibility_report, session_breakdown, related_sessions}`. `statistics` holds `total_campers`, `total_bunks`, `total_capacity`, `total_requests`, `campers_with_requests`, `campers_without_requests` and `capacity_breakdown`; `impossibility_report` is the serialized `ImpossibilityReport` dataclass.

---

#### POST /api/solver/run-multi-session
Run the solver for each child session of a parent session. Body: `parent_session_cm_id`, `year`, `scenario` (required, as above), `apply_results`, `time_limit_per_session`, `solve_by_sex` (default true), `respect_locks`.

---

#### POST /api/solver/run-sweep
Kick off a sequential benchmark sweep across several time budgets (HTTP 202). Body: exactly one of `session_cm_id` (with `year`) or `scenario_id`; `time_budgets` (default `[30, 60, 180, 300]`, each at most 3600 seconds); optional `label`. Returns `{sweep_id, run_ids}`; poll each run with `GET /api/solver/run/{run_id}`.

#### POST /api/solver/run-sweep/{sweep_id}/cancel
Cancel an in-flight sweep (204; an unknown id is a no-op).

---

#### POST /api/sessions/{session_cm_id}/clear-assignments
Delete the draft assignments of a session and its related sessions in one scenario. Body: `session_cm_id`, `year`, `scenario` (required, 422 without it).

---

#### GET /api/solver/logs and GET /api/solver/logs/{session_id}
List the persisted solver run logs under `logs/solver/`, or fetch the logs of one session (optional `run_id` query parameter). Logs older than 30 days are pruned as new ones are written.

---

#### POST /api/solver/run/{run_id}/analyze
Returns 501: "Analysis functionality is being reimplemented".

---

### Scenario Management

#### POST /api/scenarios
Create a new planning scenario.

**Request Body:**
```json
{
  "name": "Session 1 Alternative",
  "session_cm_id": 1000001,
  "year": 2025,
  "description": "Testing different cabin arrangements",
  "copy_from_scenario": "optional-scenario-id"
}
```

**Parameters:**
- `name` (required): Display name for scenario
- `session_cm_id` (required): CampMinder session ID
- `year` (required): Camp year
- `description` (optional): Detailed description
- `copy_from_scenario` (optional): Scenario to copy from (404 if it no longer exists)
- `copy_from_production` (optional, deprecated): With neither copy field set, the scenario is seeded from production

**Response:**
```json
{
  "id": "uuid-string",
  "name": "Session 1 Alternative",
  "session_cm_id": 1000001,
  "year": 2025,
  "description": "Testing different cabin arrangements",
  "is_active": true,
  "copy_skipped": null
}
```

`copy_skipped` is set on a weekend copy: the number of rows skipped because their party or unit no longer resolves.

---

#### GET /api/scenarios
List scenarios for a session and its related sessions.

**Query Parameters:**
- `session_id` (required): CampMinder session ID
- `year` (required): Camp year
- `include_inactive` (optional, default=false): Include deleted scenarios

**Response:**
```json
[
  {
    "id": "uuid-string",
    "name": "Session 1 Alternative",
    "session_cm_id": 1000001,
    "year": 2025,
    "description": "Testing different cabin arrangements",
    "is_active": true
  }
]
```

---

#### GET /api/scenarios/{scenario_id}
Get scenario details with optional assignments.

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Query Parameters:**
- `include_assignments` (optional, default=true): Include assignment details

**Response:** the scenario object (`id`, `name`, `session_cm_id`, `year`, `description`, `is_active`), and with `include_assignments` its draft assignments.

---

#### PUT /api/scenarios/{scenario_id}
Update scenario metadata (400 if no field is given).

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "New description",
  "is_active": false
}
```

**Response:** Updated scenario object

---

#### DELETE /api/scenarios/{scenario_id}
Delete a scenario and all of its draft data.

**Response:** a `{"message": ...}` confirmation.

---

#### PUT /api/scenarios/{scenario_id}/assignments
Update or create a scenario assignment.

**Request Body:**
```json
{
  "session_cm_id": 1000001,
  "year": 2025,
  "person_id": 12345,
  "bunk_id": 67890,
  "locked": true,
  "updated_by": "user@camp.com"
}
```

**Parameters:**
- `session_cm_id` (required): CampMinder session ID
- `year` (required): Camp year
- `person_id` (required): CampMinder person ID
- `bunk_id` (optional): CampMinder bunk ID (null removes the assignment)
- `locked` (optional): Lock assignment from solver changes
- `updated_by` (optional): User identifier for audit

---

#### POST /api/scenarios/{scenario_id}/solve
Run the solver on a scenario. No request body. Reads the scenario's draft assignments (not production) and produces optimized assignments for it.

**Response:** `{"run_id": ..., "status": "started", "message": ...}`; poll `GET /api/solver/run/{run_id}`.

---

#### POST /api/scenarios/{scenario_id}/clear
Clear all assignments from a scenario.

**Request Body:**
```json
{
  "year": 2025,
  "cleared_by": "user@camp.com"
}
```

**Parameters:**
- `year` (required): Camp year, scopes the clear
- `cleared_by` (optional): User identifier for audit

---

#### GET /api/scenarios/score
Evaluate the solver objective score of a scenario or of production. Query: `session_id`, `year` (both required), `scenario_id` (omit for production). Returns the same score the optimizer would compute, so scenarios can be compared.

#### POST /api/scenarios/{scenario_id}/analyze
Returns 501: "Analysis functionality is being reimplemented".

---

### Validation Operations

#### POST /api/validate-bunking
Validate current bunking assignments for a session, checking for constraint violations, unsatisfied requests, and potential issues.

**Request Body:**
```json
{
  "session_cm_id": 1000001,
  "year": 2025,
  "scenario": "optional-scenario-id"
}
```

**Response (abridged):**
```json
{
  "statistics": {
    "total_campers": 203,
    "assigned_campers": 198,
    "unassigned_campers": 5,
    "total_requests": 45,
    "satisfied_requests": 38,
    "request_satisfaction_rate": 0.844,
    "bunks_over_capacity": 0,
    "bunks_at_capacity": 3,
    "bunks_under_capacity": 16,
    "locked_bunks": 2,
    "campers_with_no_requests": 158
  },
  "issues": [
    {
      "severity": "warning",
      "type": "valid_request_unsatisfied",
      "message": "Bunk request not satisfied: Emma Johnson wants to bunk with Olivia Chen",
      "details": {
        "request_type": "bunk_with",
        "is_first_requested": true,
        "person_id": "12345",
        "requested_person_id": "67890"
      },
      "affected_ids": ["12345", "67890"]
    },
    {
      "severity": "error",
      "type": "valid_negative_request_violated",
      "message": "Negative request violated: Liam Garcia is bunked with Samuel Johnson",
      "details": {
        "request_type": "not_bunk_with",
        "is_first_requested": false,
        "person_id": "11111",
        "requested_person_id": "22222"
      },
      "affected_ids": ["11111", "22222"]
    },
    {
      "severity": "warning",
      "type": "grade_spread_warning",
      "message": "Bunk 101 exceeds grade spread limit: 3 grades (max: 2)",
      "details": {
        "bunk_id": "101",
        "bunk_name": "Cabin A"
      },
      "affected_ids": ["4261"]
    }
  ],
  "validated_at": "2025-01-28T10:30:00Z",
  "session_id": "1000001",
  "scenario": null
}
```

`statistics` carries more than the abridged fields: `session_breakdown`, capacity utilization, per-field request stats (`field_stats`) and the material-parent counters. The full shape is `ValidationStatistics` in `bunking/bunking_validator.py`.

**Validation Checks Performed:**
- **Capacity Validation**: over-capacity bunks (`capacity_violation`)
- **Request Satisfaction**: `bunk_with` and `not_bunk_with` requests (`valid_request_unsatisfied`, `valid_negative_request_violated`)
- **Age/Grade Spread**: `age_spread_warning`, `grade_spread_warning`, `grade_adjacency_warning`, `grade_ratio_warning`
- **Flow and level**: `age_flow_inversion`, `level_regression`
- **Isolation**: `isolation_risk`
- **Assignment Coverage**: `unassigned_campers`, `stale_assignments`, `no_requests`

**Severity Levels:**
- `error`: Critical issues that must be resolved (e.g., negative request violations)
- `warning`: Issues that should be reviewed (e.g., unsatisfied positive requests)
- `info`: Informational notices

---

#### GET /api/satisfaction
Per-camper request satisfaction for a session and scenario. Query: `session` (CampMinder id), `year`, optional `scenario` (omit for production). The scope widens to AG-related sessions automatically.

---

### Request Merge and Split

#### POST /api/requests/merge
Merge several `bunk_requests` into one. Body: `request_ids` (at least 2), `keep_target_from` (must be one of them), `final_type`. Returns `merged_request_id`, `merged_request_ids` (the soft-deleted ones), `source_fields`, `confidence_score`.

#### POST /api/requests/split
Split a merged request back apart. Body: `request_id`, `split_sources` (at least one). Returns `original_request_id`, `restored_request_ids`, `updated_source_fields`.

---

## Data Models

The solver's input and output contract is the `DirectSolver*` dataclasses in `bunking/models_v2.py` (`DirectSolverInput` carries `year`); request and response schemas for each router are in `api/schemas/`. The generated TypeScript mirror is `frontend/src/types/api-generated/`.

## Error Handling

The API uses standard HTTP status codes:

- **200 OK**: Successful operation
- **202 Accepted**: Sweep started
- **204 No Content**: Sweep cancelled
- **400 Bad Request**: Invalid input parameters
- **401 / 403**: Not signed in, or missing `bunking.manage`
- **404 Not Found**: Resource not found
- **409 Conflict**: A solver run for this session is already in progress
- **422 Unprocessable Entity**: Validation error, or a missing scenario
- **501 Not Implemented**: The `analyze` endpoints
- **500 Internal Server Error**: Server error

Error responses include detail. A 500 is always the generic `{"detail": "Internal server error"}`; the real error is only in the server log.
```json
{
  "detail": "Error message describing what went wrong"
}
```

## Performance Considerations

### Solver Time Limits
- Default: 60 seconds
- Maximum: 600 seconds (10 minutes); sweep budgets may go to 3600
- Larger sessions may need longer time limits

### Async Processing
- Solver runs execute in background
- Poll `/api/solver/run/{run_id}` for status
- In-memory run state is lost on an API restart; completed runs are read back from PocketBase without the diagnostics

### Batch Operations
- Scenario copy operations may be slow for large sessions
- Clear operations use batch deletes

## Integration Notes

### PocketBase Integration
- Service connects to PocketBase on port 8090
- Uses admin credentials for full access
- Real-time sync not implemented (polling required)

### Frontend Integration
- Frontend polls for solver status
- WebSocket support planned for future
- Optimistic updates for manual changes

### Monitoring
- Health endpoint for uptime monitoring
- Structured logging for debugging
- Performance metrics in logs

## Example Workflows

### Basic Solving
```bash
# 1. Create (or reuse) a scenario. The solver only ever writes a scenario's
#    draft assignments — production is read-only for the solver (kindred#2467) —
#    so a run has to name one to have anywhere legal to land.
POST /api/scenarios
{
  "name": "Session 1 Draft",
  "session_cm_id": 1000001,
  "year": 2025
}
# Returns: {"id": "scn_abc123", "name": "Session 1 Draft", ...}

# 2. Start solver run against that scenario
POST /api/solver/run
{
  "session_cm_id": 1000001,
  "year": 2025,
  "scenario": "scn_abc123",
  "time_limit": 60
}
# Returns: {"run_id": "abc123", "status": "started", ...}
# A request with no "scenario" (or a blank one) is refused with 422 here,
# before the solver ever runs.

# 3. Check status
GET /api/solver/run/abc123
# Returns: {"status": "completed", "results": {...}}

# 4. Apply results to the scenario's draft assignments
POST /api/solver/apply/abc123
# Returns: {"message": "Applied 150 assignments to bunk_assignments_draft"}
```

### Scenario Planning
```bash
# 1. Create scenario
POST /api/scenarios
{
  "name": "What if we split Bunk A1?",
  "session_cm_id": 1000001,
  "year": 2025
}

# 2. Make manual adjustments
PUT /api/scenarios/{id}/assignments
{
  "session_cm_id": 1000001,
  "year": 2025,
  "person_id": 12345,
  "bunk_id": 67890,
  "locked": true
}

# 3. Run solver with adjustments
POST /api/scenarios/{id}/solve

# 4. Review and compare results
GET /api/scenarios/{id}?include_assignments=true
GET /api/scenarios/score?session_id=1000001&year=2025&scenario_id={id}
```

---

## Social Graph Endpoints

### Session Social Graph

```http
GET /api/sessions/{session_cm_id}/social-graph
```

Retrieve full social graph for a camp session.

**Note**: Self-referential edges (where source equals target) are automatically prevented during graph construction.

#### Query Parameters
- `year` (optional): Target year (defaults to the current calendar year)
- `include_metrics` (optional): Include graph metrics (default: true)
- `layout` (optional): Graph layout algorithm - force, circle, or hierarchical (default: force)
- `edge_types` (optional): Comma-separated edge types to include
- `scenario_id` (optional): Source bunk assignments from this scenario's drafts instead of production (needs `bunking.manage`)
- `units` (optional): Comma-separated unit slugs to scope to
- `bunks` (optional): Comma-separated lowercase bunk codes to scope to
- `cross_scope` (optional, default false): With a scope active, include edges crossing the scope boundary as ghosted

#### Response (200 OK)
```json
{
  "nodes": [
    {
      "id": 12345,
      "name": "Sarah Johnson",
      "grade": 6,
      "bunk_cm_id": 100,
      "bunk_name": "Bunk A",
      "centrality": 0.25,
      "clustering": 0.6,
      "community": 1,
      "satisfaction_status": "satisfied"
    }
  ],
  "edges": [
    {
      "source": 12345,
      "target": 12346,
      "weight": 1.0,
      "edge_type": "request",
      "request_type": "bunk_with",
      "reciprocal": true
    }
  ],
  "metrics": {
    "density": 0.42,
    "average_clustering": 0.65,
    "number_of_components": 3,
    "average_degree": 2.1
  },
  "communities": {
    "1": [12345, 12346, 12347],
    "2": [12348, 12349]
  },
  "warnings": [
    "3 isolated campers detected",
    "Friend group 'group1' is split across multiple bunks"
  ],
  "layout_positions": {
    "12345": [100, 200],
    "12346": [150, 220]
  },
  "edge_type_counts": {"request": 2},
  "cross_scope_edges": [],
  "cross_scope_nodes": []
}
```

Node objects also carry `parent_satisfaction_status`, `staff_satisfaction_status`, `first_year` and `last_year_session`; edges also carry `confidence`, `metadata` and `cross_scope` (`api/schemas/social_graph.py`).

### Update Camper Position (Incremental)
```http
PATCH /api/sessions/{session_cm_id}/campers/{person_cm_id}/position
```
Update a camper's bunk position with incremental graph updates. Optimized for drag-drop operations to avoid full graph rebuilds. Requires `bunking.manage`.

#### Path Parameters
- `session_cm_id`: CampMinder session ID
- `person_cm_id`: CampMinder person ID

#### Query Parameters
- `year` (optional): Target year (defaults to the current calendar year)
- `scenario_id` (optional): Use the scenario-scoped graph cache slot

#### Request Body
```json
{
  "new_bunk_cm_id": 12345
}
```

#### Response (200 OK)
```json
{
  "updated_node": {
    "id": 16697340,
    "old_bunk_cm_id": 12344,
    "new_bunk_cm_id": 12345
  },
  "affected_edges": [
    {
      "source": 16697340,
      "target": 13504737,
      "type": "request",
      "request_type": "bunk_with",
      "reciprocal": true
    }
  ],
  "cache_invalidated": true
}
```

#### Error Responses
- **400 Bad Request**: Person not found in graph
- **500 Internal Server Error**: Failed to update position

#### Performance Notes
- Uses backend graph cache for fast updates
- Only returns changed data (not entire graph)
- Automatically invalidates affected cached graphs
- Falls back to traditional assignment if incremental update fails

### Bunk Social Graph

```http
GET /api/bunks/{bunk_cm_id}/social-graph
```

Analyze social dynamics within a specific bunk.

#### Query Parameters
- `session_cm_id` (required): Session ID
- `year` (optional): Target year (defaults to the current calendar year)
- `scenario_id` (optional): Source bunk membership from a scenario's drafts
- `cross_scope` (optional, default false): Include edges that leave the bunk as ghosted context

#### Response (200 OK)
```json
{
  "bunk_cm_id": 100,
  "bunk_name": "Bunk A",
  "nodes": [...],
  "edges": [...],
  "metrics": {
    "cohesion_score": 0.75,
    "average_degree": 2.5,
    "density": 0.4,
    "isolated_count": 1,
    "suggestions": [
      "Help isolated camper Sarah make connections",
      "Consider buddy assignment for weakly connected Jake"
    ]
  },
  "health_score": 0.68,
  "cross_scope_edges": [],
  "cross_scope_nodes": []
}
```

## Future Enhancements

1. **WebSocket Support**: Real-time solver progress updates
2. **Bulk Operations**: Update multiple assignments at once
3. **Constraint Templates**: Save and reuse constraint sets
4. **Comparison API**: Compare scenarios side-by-side
5. **Export Endpoints**: Download results in various formats
6. **Machine Learning**: Name matching improvements
7. **Analytics API**: Historical success metrics
8. **Notification Webhooks**: Alert on conflicts/issues