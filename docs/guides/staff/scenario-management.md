# Scenario Management Guide

## Overview

Scenarios allow you to create and test different bunking arrangements without affecting production assignments. This guide covers how to create, manage, and use scenarios for planning purposes.

## Key Concepts

### What is a Scenario?
- A complete set of bunking assignments for a session
- Can be copied from production or started fresh
- Supports manual adjustments and solver runs
- Tracked with full history of changes

### Scenario Lifecycle
1. **Create**: Copy from production or start empty
2. **Modify**: Manual assignments or solver runs
3. **Validate**: Check for issues and conflicts
4. **Compare**: Review differences from production
5. **Apply**: Optionally apply to production

## Creating Scenarios

### Via Frontend
1. Navigate to the session's bunking page
2. Click "Manage Scenarios" in the top toolbar
3. Click "Create New Scenario"
4. Choose options:
   - **Name**: Descriptive name for the scenario
   - **Copy from Production**: Start with current assignments
   - **Start Empty**: Begin with no assignments

### Via API
```bash
curl -X POST http://localhost:8000/scenarios \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Summer 2025 Alternative",
    "session_cm_id": 1000001,
    "description": "Testing friend group optimization",
    "copy_from_production": true
  }'
```

## Working with Scenarios

### Switching Between Scenarios
- Use the scenario dropdown in the frontend toolbar
- API: Include `scenario_id` in requests
- Changes are isolated to the active scenario

### Making Manual Adjustments
1. Activate the scenario
2. Drag and drop campers between bunks
3. Lock assignments to prevent solver changes
4. All changes are tracked in scenario history

### Running the Solver
- Solver respects locked assignments in scenarios
- Results only affect the active scenario
- Can compare results across multiple scenarios

## Scenario Operations

### Listing Scenarios
```bash
# All active scenarios for a session
curl "http://localhost:8000/scenarios?session_id=1000001"

# Include deleted scenarios
curl "http://localhost:8000/scenarios?session_id=1000001&include_inactive=true"
```

### Updating Scenario Metadata
```bash
curl -X PUT http://localhost:8000/scenarios/{scenario_id} \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name",
    "description": "New description"
  }'
```

### Clearing a Scenario
```bash
curl -X POST http://localhost:8000/scenarios/{scenario_id}/clear \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Deleting a Scenario
```bash
# Soft delete (can be recovered)
curl -X DELETE http://localhost:8000/scenarios/{scenario_id}
```

## Scenario History

All changes to scenarios are tracked:
- Who made the change
- When it occurred
- What type of change
- Detailed change data

### Change Types
- `created`: Scenario was created
- `assignment_added`: Camper assigned to bunk
- `assignment_removed`: Camper removed from bunk
- `assignment_moved`: Camper moved between bunks
- `cleared`: All assignments removed
- `solver_run`: Solver executed on scenario
- `renamed`: Scenario metadata updated

### Viewing History
```bash
curl http://localhost:8000/scenarios/{scenario_id}/history
```

## Best Practices

### Naming Conventions
- Use descriptive names that indicate purpose
- Include date or version if testing iterations
- Examples:
  - "Friend Groups Optimized - v2"
  - "Grade Balance Test - Jan 2025"
  - "Manual Adjustments - Final"

### Testing Strategies
1. **A/B Testing**: Create two scenarios with different approaches
2. **Incremental Changes**: Start with production, make small adjustments
3. **Clean Slate**: Start empty for completely fresh approach
4. **Constraint Testing**: Adjust solver weights in different scenarios

### Validation Workflow
1. Create scenario with changes
2. Run validation endpoint
3. Review issues and statistics
4. Make adjustments as needed
5. Compare with production baseline

## Advanced Features

### Scenario Comparison
Compare assignments between scenarios:
```bash
curl "http://localhost:8000/scenarios/compare?scenario_a={id1}&scenario_b={id2}"
```

### Bulk Operations
Apply the same change to multiple scenarios:
```bash
# Lock a camper in the same bunk across scenarios
curl -X POST http://localhost:8000/scenarios/bulk-update \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_ids": ["id1", "id2", "id3"],
    "updates": [{
      "person_cm_id": 12345,
      "bunk_cm_id": 67890,
      "locked": true
    }]
  }'
```

### Applying to Production
When ready to use a scenario:
```bash
curl -X POST http://localhost:8000/scenarios/{scenario_id}/apply-to-production \
  -H "Content-Type: application/json" \
  -d '{
    "backup_current": true
  }'
```

## Troubleshooting

### Common Issues

**Scenario Not Loading**
- Check scenario_id is valid
- Ensure scenario is active (not deleted)
- Verify session_cm_id matches

**Changes Not Saving**
- Confirm you're in scenario mode
- Check for API errors in response
- Verify scenario isn't locked

**Solver Not Respecting Changes**
- Ensure assignments are properly locked
- Check solver constraints configuration
- Verify scenario data integrity

### Data Integrity
```bash
# Validate scenario data
curl http://localhost:8000/scenarios/{scenario_id}/validate

# Repair inconsistencies
curl -X POST http://localhost:8000/scenarios/{scenario_id}/repair
```

## Integration with Other Features

### Friend Groups
- Scenarios respect friend group definitions
- Can test different friend group configurations
- Validation shows friend group split statistics

### Bunk Requests
- All requests apply to scenarios
- Can test request satisfaction rates
- Compare request fulfillment across scenarios

### Validation
- Run validation on any scenario
- Compare validation results
- Use for quality assurance

## Performance Considerations

- Scenarios add minimal overhead
- Each scenario stores only differences
- History is periodically archived
- Inactive scenarios can be purged

### Cleanup Operations
```bash
# Archive old scenario history
curl -X POST http://localhost:8000/scenarios/archive-history \
  -d '{"older_than_days": 90}'

# Purge deleted scenarios
curl -X POST http://localhost:8000/scenarios/purge-deleted \
  -d '{"older_than_days": 30}'
```