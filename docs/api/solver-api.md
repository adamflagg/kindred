# Solver Service API Documentation

## Overview

The Solver Service is a FastAPI application that provides constraint satisfaction solving for camp cabin assignments. It uses Google OR-Tools CP-SAT solver to optimize bunking arrangements while respecting various constraints and preferences.

**Base URL**: `http://localhost:8000`  
**API Documentation**: `http://localhost:8000/docs` (Swagger UI)

## Authentication

Currently, the solver service does not implement authentication. In production, it should be deployed behind a reverse proxy with appropriate authentication.

## Core Concepts

### Solver Runs
- Asynchronous solving process identified by `run_id`
- Can check status and retrieve results later
- Configurable time limits (1-600 seconds)

### Scenarios
- What-if planning for different bunking arrangements
- Copy from production or start fresh
- Support for manual adjustments and locking

### Assignments
- Map persons to bunks for a session
- Can be solver-generated or manual
- Support for "locked" assignments that solver respects

## API Endpoints

### Health Check

#### GET /health
Check service health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "kindred-solver"
}
```

---

### Solver Operations

#### POST /solver/run
Start a new solver run for a session.

**Request Body:**
```json
{
  "session_id": "string",
  "respect_locks": true,
  "apply_results": false,
  "time_limit": 30
}
```

**Parameters:**
- `session_id` (required): CampMinder session ID to solve
- `respect_locks` (optional, default=true): Honor locked assignments
- `apply_results` (optional, default=false): Auto-apply results to production
- `time_limit` (optional, default=30): Max seconds to run (1-600)

**Response:**
```json
{
  "run_id": "uuid-string",
  "status": "started",
  "message": "Solver run started"
}
```

**Status Codes:**
- 200: Solver run started successfully
- 400: Invalid parameters
- 500: Internal server error

---

#### GET /solver/run/{run_id}
Get status and results of a solver run.

**Path Parameters:**
- `run_id`: The solver run identifier

**Response (Pending):**
```json
{
  "id": "uuid-string",
  "status": "pending",
  "results": null,
  "error_message": null
}
```

**Response (Completed):**
```json
{
  "id": "uuid-string",
  "status": "completed",
  "results": {
    "assignments": [
      {
        "person_id": "string",
        "bunk_id": "string",
        "person_name": "string",
        "bunk_name": "string"
      }
    ],
    "unassigned": ["person_id1", "person_id2"],
    "summary": {
      "total_campers": 150,
      "assigned_campers": 148,
      "unassigned_campers": 2,
      "bunks_used": 12,
      "objective_value": 0.95
    }
  },
  "error_message": null
}
```

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

#### POST /solver/apply/{run_id}
Apply solver results to production bunk assignments.

**Path Parameters:**
- `run_id`: The solver run identifier

**Response:**
```json
{
  "message": "Applied 148 assignments"
}
```

**Status Codes:**
- 200: Results applied successfully
- 404: Run not found
- 400: Run not completed or already applied

---

### Scenario Management

#### POST /scenarios
Create a new planning scenario.

**Request Body:**
```json
{
  "name": "Session 1 Alternative",
  "session_cm_id": 1000001,
  "description": "Testing different cabin arrangements",
  "copy_from_production": true,
  "created_by": "user@camp.com"
}
```

**Parameters:**
- `name` (required): Display name for scenario
- `session_cm_id` (required): CampMinder session ID
- `description` (optional): Detailed description
- `copy_from_production` (optional, default=true): Copy current assignments
- `created_by` (optional): User identifier for audit

**Response:**
```json
{
  "id": "uuid-string",
  "name": "Session 1 Alternative",
  "session_cm_id": 1000001,
  "description": "Testing different cabin arrangements",
  "is_active": true,
  "created": "2025-01-27T10:00:00Z",
  "updated": "2025-01-27T10:00:00Z",
  "created_by": "user@camp.com"
}
```

---

#### GET /scenarios
List scenarios for a session.

**Query Parameters:**
- `session_id` (required): CampMinder session ID
- `include_inactive` (optional, default=false): Include deleted scenarios

**Response:**
```json
[
  {
    "id": "uuid-string",
    "name": "Session 1 Alternative",
    "session_cm_id": 1000001,
    "description": "Testing different cabin arrangements",
    "is_active": true,
    "created": "2025-01-27T10:00:00Z",
    "updated": "2025-01-27T10:00:00Z"
  }
]
```

---

#### GET /scenarios/{scenario_id}
Get scenario details with optional assignments.

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Query Parameters:**
- `include_assignments` (optional, default=true): Include assignment details

**Response:**
```json
{
  "scenario": {
    "id": "uuid-string",
    "name": "Session 1 Alternative",
    "session_cm_id": 1000001,
    "is_active": true
  },
  "assignments": [
    {
      "id": "uuid-string",
      "scenario": "scenario-id",
      "person_cm_id": 12345,
      "bunk_cm_id": 67890,
      "locked": false,
      "created": "2025-01-27T10:00:00Z"
    }
  ]
}
```

---

#### PUT /scenarios/{scenario_id}
Update scenario metadata.

**Path Parameters:**
- `scenario_id`: Scenario identifier

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

#### DELETE /scenarios/{scenario_id}
Delete a scenario (soft delete).

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Response:**
```json
{
  "message": "Scenario 'Session 1 Alternative' deleted successfully"
}
```

---

### Validation Operations

#### POST /validate-bunking
Validate current bunking assignments for a session, checking for constraint violations, unsatisfied requests, and potential issues.

**Request Body:**
```json
{
  "session_id": "oooz3l80snb9e5e",
  "scenario_id": "optional-scenario-id"
}
```

**Response:**
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
    "campers_with_no_requests": 158,

  },
  "issues": [
    {
      "severity": "warning",
      "type": "unsatisfied_request",
      "message": "Bunk request not satisfied: John Doe wants to bunk with Jane Smith",
      "details": {
        "request_type": "bunk_with",
        "priority": 8,
        "person_id": "12345",
        "requested_person_id": "67890"
      },
      "affected_ids": ["12345", "67890"]
    },
    {
      "severity": "error",
      "type": "negative_request_violated",
      "message": "Negative request violated: Sam Johnson is bunked with Alex Miller",
      "details": {
        "request_type": "not_bunk_with",
        "priority": 10,
        "person_id": "11111",
        "requested_person_id": "22222"
      },
      "affected_ids": ["11111", "22222"]
    },
    {
      "severity": "warning",
      "type": "spread_violation",
      "message": "Bunk 101 exceeds grade spread limit: 3 grades (max: 2)",
      "details": {
        "bunk_id": "101",
        "bunk_name": "Cabin A",
        "current_spread": 3,
        "max_allowed": 2,
        "spread_type": "grade"
      },
      "affected_ids": ["4261"]
    }
  ],
  "validated_at": "2025-01-28T10:30:00Z",
  "session_id": "1000002",
  "scenario_id": null
}
```

**Validation Checks Performed:**
- **Capacity Validation**: Checks for over/under capacity bunks
- **Request Satisfaction**: Analyzes bunk_with and not_bunk_with requests
- **Friend Group Integrity**: Checks if friend groups are kept together
- **Age/Grade Spread**: Validates bunks don't exceed configured spread limits
- **Assignment Coverage**: Identifies unassigned campers
- **Lock Status**: Reports on locked bunks

**Severity Levels:**
- `error`: Critical issues that must be resolved (e.g., negative request violations)
- `warning`: Issues that should be reviewed (e.g., unsatisfied positive requests)
- `info`: Informational notices (e.g., bunks approaching capacity)

---

#### PUT /scenarios/{scenario_id}/assignments
Update or create a scenario assignment.

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Request Body:**
```json
{
  "person_cm_id": 12345,
  "bunk_cm_id": 67890,
  "locked": true,
  "updated_by": "user@camp.com"
}
```

**Parameters:**
- `person_cm_id` (required): CampMinder person ID
- `bunk_cm_id` (optional): Bunk ID (null to remove assignment)
- `locked` (optional): Lock assignment from solver changes
- `updated_by` (optional): User identifier for audit

**Response:**
```json
{
  "message": "Assignment updated"
}
```

---

#### POST /scenarios/{scenario_id}/solve
Run solver on a scenario.

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Response:**
```json
{
  "run_id": "uuid-string",
  "status": "started",
  "message": "Solver run started for scenario 'Session 1 Alternative'"
}
```

---

#### POST /scenarios/{scenario_id}/clear
Clear all assignments from a scenario.

**Path Parameters:**
- `scenario_id`: Scenario identifier

**Request Body:**
```json
{
  "cleared_by": "user@camp.com"
}
```

**Parameters:**
- `cleared_by` (optional): User identifier for audit

**Response:**
```json
{
  "message": "Cleared 145 assignments from scenario"
}
```

## Data Models

### Camper
```typescript
{
  campminder_id: string;
  first_name: string;
  last_name: string;
  age: number;
  grade: number;
  years_at_camp: number[];
  returning: boolean;
  sessions: string[];
}
```

### Bunk
```typescript
{
  campminder_id: string;
  name: string;
  capacity: number;
  min_capacity: number;
  division: string;
}
```

### Constraint
Various constraint types including:
- Age cohesion (minimize age spread)
- Grade cohesion (minimize grade spread)
- Friend requests (mutual and one-way)
- Not-together requests
- Experience distribution
- Returning camper grouping

## Error Handling

The API uses standard HTTP status codes:

- **200 OK**: Successful operation
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid input parameters
- **404 Not Found**: Resource not found
- **422 Unprocessable Entity**: Validation error
- **500 Internal Server Error**: Server error

Error responses include detail:
```json
{
  "detail": "Error message describing what went wrong"
}
```

## Performance Considerations

### Solver Time Limits
- Default: 30 seconds
- Maximum: 600 seconds (10 minutes)
- Larger sessions may need longer time limits

### Async Processing
- Solver runs execute in background
- Poll `/solver/run/{run_id}` for status
- Results cached for retrieval

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
# 1. Start solver run
POST /solver/run
{
  "session_id": "1000001",
  "time_limit": 60
}
# Returns: {"run_id": "abc123", "status": "started"}

# 2. Check status
GET /solver/run/abc123
# Returns: {"status": "completed", "results": {...}}

# 3. Apply results
POST /solver/apply/abc123
# Returns: {"message": "Applied 150 assignments"}
```

### Scenario Planning
```bash
# 1. Create scenario
POST /scenarios
{
  "name": "What if we split Bunk A1?",
  "session_cm_id": 1000001,
  "copy_from_production": true
}

# 2. Make manual adjustments
PUT /scenarios/{id}/assignments
{
  "person_cm_id": 12345,
  "bunk_cm_id": 67890,
  "locked": true
}

# 3. Run solver with adjustments
POST /scenarios/{id}/solve

# 4. Review and compare results
GET /scenarios/{id}?include_assignments=true
```

---

### Enhanced Request System Endpoints

#### GET /api/solver-config
Get all solver configuration values.

**Response:**
```json
[
  {
    "key": "priority.bunk_with.base",
    "value": 10,
    "description": "Base priority for standard bunk-with requests",
    "category": "Request Priorities",
    "friendly_name": "Standard Request Priority"
  },
  // ... more config values
]
```

---

#### GET /api/solver-config/{key}
Get a specific configuration value.

**Path Parameters:**
- `key`: Configuration key (e.g., "priority.bunk_with.base")

**Response:**
```json
{
  "key": "priority.bunk_with.base",
  "value": 10,
  "description": "Base priority for standard bunk-with requests",
  "category": "Request Priorities"
}
```

---

#### PUT /api/solver-config/{key}
Update a configuration value.

**Path Parameters:**
- `key`: Configuration key

**Request Body:**
```json
{
  "value": 15
}
```

**Response:**
```json
{
  "message": "Configuration updated successfully",
  "key": "priority.bunk_with.base",
  "old_value": 10,
  "new_value": 15
}
```

---

#### POST /api/solver-config/reset
Reset all configuration values to defaults.

**Response:**
```json
{
  "message": "Configuration reset to defaults",
  "reset_count": 26
}
```

---

### Friend Group Management

#### GET /api/friend-groups
Get friend groups for a session.

**Query Parameters:**
- `session_cm_id` (required): CampMinder session ID
- `year` (required): Camp year
- `include_inactive` (optional, default=false): Include deactivated groups

**Response:**
```json
[
  {
    "id": "fg123",
    "name": "Cabin 3 Returners",
    "session_cm_id": 1000001,
    "year": 2025,
    "member_cm_ids": [12345, 12346, 12347],
    "completeness_score": 0.83,
    "stability_score": 0.90,
    "is_active": true,
    "manually_created": false
  }
]
```

---

#### GET /api/friend-groups/{group_id}
Get details of a specific friend group.

**Response includes:**
- Group metadata
- Member details with current bunk assignments
- Connection analysis
- History if available

---

#### POST /api/friend-groups
Create a manual friend group.

**Request Body:**
```json
{
  "name": "Special Needs Group",
  "session_cm_id": 1000001,
  "year": 2025,
  "member_cm_ids": [12345, 12346],
  "manually_created": true,
  "notes": "Medical compatibility required"
}
```

---

#### PUT /api/friend-groups/{group_id}
Update a friend group.

**Request Body:**
```json
{
  "name": "Updated Name",
  "member_cm_ids": [12345, 12346, 12347, 12348],
  "is_active": true
}
```

---

#### DELETE /api/friend-groups/{group_id}
Deactivate a friend group.

---

### Request Conflicts

#### GET /api/conflicts
Get unresolved conflicts for a session.

**Query Parameters:**
- `session_cm_id` (required): CampMinder session ID
- `year` (required): Camp year
- `type` (optional): Filter by conflict type

**Response:**
```json
[
  {
    "id": "conf123",
    "conflict_group_id": "grp456",
    "requester_person_cm_id": 12345,
    "conflict_type": "impossible_pair",
    "conflict_details": {
      "person_a": 12345,
      "person_b": 12346,
      "reason": "A wants B, but B does not want A"
    },
    "resolution_status": "pending"
  }
]
```

---

#### PUT /api/conflicts/{conflict_id}/resolve
Resolve a conflict.

**Request Body:**
```json
{
  "resolution_choice": {
    "action": "honor_negative",
    "notes": "Family confirmed incompatibility"
  },
  "resolved_by": "staff@camp.com"
}
```

---

### Manual Review

#### GET /api/manual-review
Get items requiring manual review.

**Query Parameters:**
- `session_cm_id` (required): CampMinder session ID
- `year` (required): Camp year
- `type` (optional): Filter by review type
- `status` (optional): Filter by status (pending/resolved)

**Response:**
```json
[
  {
    "id": "rev123",
    "item_type": "bunk_request",
    "item_id": "req456",
    "reason": "Low confidence name match",
    "data": {
      "original_text": "Jake M.",
      "possible_matches": [
        {"cm_id": 12345, "name": "Jake Miller", "confidence": 0.75},
        {"cm_id": 12346, "name": "Jake Morrison", "confidence": 0.70}
      ]
    },
    "status": "pending"
  }
]
```

---

#### PUT /api/manual-review/{review_id}
Resolve a manual review item.

**Request Body:**
```json
{
  "decision": "approve",
  "selected_match_cm_id": 12345,
  "notes": "Confirmed with family",
  "reviewed_by": "staff@camp.com"
}
```

---

### Bunk Request Management

#### GET /api/bunk-requests/bulk-update
Bulk update multiple bunk requests.

**Request Body:**
```json
{
  "request_ids": ["req1", "req2", "req3"],
  "updates": {
    "status": "resolved",
    "priority_locked": true
  }
}
```

**Response:**
```json
{
  "message": "Updated 3 requests",
  "updated_count": 3
}
```

---

#### POST /api/bunk-requests/validate-names
Validate and match names in bulk.

**Request Body:**
```json
{
  "session_cm_id": 1000001,
  "year": 2025,
  "names": ["Sarah Johnson", "Jake M.", "Emma Wilson"]
}
```

**Response:**
```json
[
  {
    "name": "Sarah Johnson",
    "matches": [
      {"cm_id": 12345, "full_name": "Sarah Johnson", "confidence": 1.0}
    ]
  },
  {
    "name": "Jake M.",
    "matches": [
      {"cm_id": 12346, "full_name": "Jake Miller", "confidence": 0.75},
      {"cm_id": 12347, "full_name": "Jake Morrison", "confidence": 0.70}
    ]
  }
]
```

## Social Graph Endpoints

### Session Social Graph

```http
GET /api/sessions/{session_cm_id}/social-graph
```

Retrieve full social graph for a camp session. 

**Note**: Self-referential edges (where source equals target) are automatically prevented during graph construction.

#### Query Parameters
- `year` (optional): Target year (defaults to current)
- `include_metrics` (optional): Include graph metrics (default: true)
- `include_historical` (optional): Include historical edges (default: false)
- `layout` (optional): Graph layout algorithm - force, circle, or hierarchical (default: force)

#### Response (200 OK)
```json
{
  "nodes": [
    {
      "id": 12345,
      "name": "Sarah Johnson",
      "bunk_id": 100,
      "bunk_name": "Bunk A",
      "degree": 5,
      "isolated": false
    }
  ],
  "edges": [
    {
      "source": 12345,
      "target": 12346,
      "weight": 1.0,
      "type": "bunk_request"
    }
  ],
  "metrics": {
    "density": 0.42,
    "clustering_coefficient": 0.65,
    "connected_components": 3
  },
  "communities": {
    "community_1": [12345, 12346, 12347],
    "community_2": [12348, 12349]
  },
  "warnings": [
    "3 isolated campers detected",
    "Friend group 'group1' is split across multiple bunks"
  ],
  "layout_positions": {
    "12345": {"x": 100, "y": 200},
    "12346": {"x": 150, "y": 220}
  }
}
```

### Update Camper Position (Incremental)
```http
PATCH /api/sessions/{session_cm_id}/campers/{person_cm_id}/position
```
Update a camper's bunk position with incremental graph updates. Optimized for drag-drop operations to avoid full graph rebuilds.

#### Path Parameters
- `session_cm_id`: CampMinder session ID
- `person_cm_id`: CampMinder person ID

#### Query Parameters
- `year` (optional): Target year (defaults to current)

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
- `year` (optional): Target year (defaults to current)

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
  "health_score": 0.68
}
```

### Person Ego Network

```http
GET /api/persons/{person_cm_id}/ego-network
```

Analyze individual's social network.

#### Query Parameters
- `session_cm_id` (optional): Session filter
- `radius` (optional): Network radius (default: 2)
- `include_historical` (optional): Include historical connections

#### Response (200 OK)
```json
{
  "center_node": {
    "id": 12345,
    "name": "Sarah Johnson",
    "bunk_name": "Bunk A"
  },
  "nodes": [...],
  "edges": [...],
  "radius": 2,
  "metrics": {
    "degree": 5,
    "degree_centrality": 0.25,
    "clustering_coefficient": 0.6,
    "friends_count": 5,
    "network_size": 12
  },

}
```

### Enhanced Friend Group Detection

```http
POST /api/sessions/{session_cm_id}/detect-friend-groups
```

Detect friend groups using NetworkX algorithms.

#### Query Parameters
- `year` (optional): Target year
- `min_size` (optional): Minimum group size (default: 3)
- `max_size` (optional): Maximum group size (default: 8)
- `auto_create` (optional): Automatically create groups above threshold
- `method` (optional): Detection method - louvain, clique, or hybrid (default: hybrid)
- `background` (optional): Run in background (default: true)

#### Response (202 Accepted - Background)
```json
{
  "detection_id": "det_123abc",
  "status": "pending",
  "message": "Friend group detection started in background"
}
```

#### Response (200 OK - Synchronous)
```json
{
  "detection_id": "det_123abc",
  "status": "completed",
  "groups_found": 12,
  "coverage": 0.85,
  "stats": {
    "total_campers": 100,
    "campers_in_groups": 85,
    "average_group_size": 5.2,
    "largest_group": 8,
    "smallest_group": 3
  }
}
```

### Detection Status

```http
GET /social-graph/detection/{detection_id}
```

Track friend group detection progress.

#### Response (200 OK)
```json
{
  "detection_id": "det_123abc",
  "status": "in_progress",
  "progress": 0.65,
  "phase": "Community detection",
  "groups_found": 8,
  "time_elapsed": 2.5
}
```

### Solver Run Analysis

```http
POST /solver/run/{run_id}/analyze
```

Analyze solver run results for patterns and issues.

#### Response (200 OK)
```json
{
  "run_id": "run_123",
  "analysis": {
    "satisfied_requests": 85,
    "total_requests": 100,
    "satisfaction_rate": 0.85,
    "friend_group_cohesion": 0.72,
    "isolated_campers": 3,
    "constraint_violations": []
  }
}
```

### Scenario Analysis

```http
POST /scenarios/{scenario_id}/analyze
```

Analyze scenario assignments for social dynamics.

#### Response (200 OK)
```json
{
  "scenario_id": "scn_456",
  "analysis": {
    "bunks_analyzed": 10,
    "average_cohesion": 0.68,
    "problematic_bunks": ["Bunk C", "Bunk F"],
    "overall_health": 0.75
  }
}
```

## Configuration Endpoints

### Get Configuration Categories

```http
GET /solver-config/categories
```

Get available configuration categories.

#### Response (200 OK)
```json
{
  "categories": [
    "constraints",
    "weights",
    "limits",
    "features"
  ]
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