# Solver Configuration Guide

This guide covers the solver configuration system that allows administrators and bunking teams to fine-tune the constraint solver behavior through the web interface.

## Overview

The solver configuration system provides a comprehensive interface for adjusting how the OR-Tools constraint solver makes bunking decisions. Configuration values control priorities, constraints, and optimization objectives.

## Configuration Categories

### 1. Priority Settings
Control how different types of bunk requests are prioritized:
- **Age Preference Priority** (`priority.age_preference.default`): Base priority for age preference requests (1-10)
- **"Must Be With" Boost** (`priority.keyword_boost.must_be_with`): Extra priority for emphatic requests (1-10)
- **#1 Request Boost** (`priority.keyword_boost.hashtag_one`): Priority boost for top priority requests (1-10)

### 2. Constraint Settings
Define hard and soft constraints for cabin assignments:

#### Grade and Age Constraints
- **Maximum Grade Spread** (`constraint.grade_spread.max`): Max number of grades in a cabin (e.g., 2 = only 6th and 7th grade)
- **Maximum Age Spread** (`constraint.age_spread.months`): Max age difference in months
- **Grade Ratio Limit** (`constraint.grade_ratio.max_percentage`): Max percentage of cabin from single grade
- **Grade Ratio Penalty** (`constraint.grade_ratio.penalty`): Penalty weight for violations

#### Friend Group Constraints
- **Max Friend Group Size** (`constraint.friend_group.max_dominance`): Largest group before considering splitting
- **Min Friend Group Size** (`constraint.friend_group.min_dominance`): Minimum size to trigger dominance checks
- **Require Pair Connection** (`constraint.friend_group.require_pair_connection`): Require mutual connections

#### Request Satisfaction
- **Must Satisfy One** (`constraint.must_satisfy_one.enabled`): Require at least one request satisfied per camper
- **Satisfaction Penalty** (`constraint.must_satisfy_one.penalty`): Penalty for leaving a camper unsatisfied (default: 100,000)
- **Fallback to Age** (`constraint.must_satisfy_one.fallback_to_age`): Count age preference as satisfying requirement
- **Ignore Impossible** (`constraint.must_satisfy_one.ignore_impossible_requests`): Skip requests for out-of-session campers

#### Level Progression
- **No Regression** (`constraint.level_progression.no_regression`): Prevent moving to lower level bunks
- **Prefer Progression** (`constraint.level_progression.prefer_progression`): Encourage moving to higher levels

#### Cabin Capacity
- **Default Capacity** (`constraint.cabin_capacity.default`): Standard cabin size (8-14)
- **Maximum Capacity** (`constraint.cabin_capacity.max`): Max with override (8-16)
- **Mode** (`constraint.cabin_capacity.mode`): "hard" or "soft" constraint
- **Penalty** (`constraint.cabin_capacity.penalty`): Penalty for exceeding in soft mode

#### Flow Constraints
- **Age/Grade Flow** (`constraint.age_grade_flow.weight`): Encourage age progression across cabin numbers
- **Grade Cohesion** (`constraint.grade_cohesion.weight`): Keep same grades in adjacent bunks

### 3. Objective Settings
Control the optimization objectives:

#### Source Multipliers
Adjust relative importance of different request sources:
- **Parent Requests** (`objective.source_multipliers.share_bunk_with`): Weight for parent bunk requests (0.1-5.0)
- **Safety Concerns** (`objective.source_multipliers.do_not_share_with`): Weight for separation requests (0.1-5.0)
- **Bunking Notes** (`objective.source_multipliers.bunking_notes`): Weight for bunking notes (0.1-5.0)
- **Internal Notes** (`objective.source_multipliers.internal_notes`): Weight for staff notes (0.1-5.0)
- **Socialize Preference** (`objective.source_multipliers.socialize_preference`): Weight for socialization preferences (0.1-5.0)

#### Diminishing Returns
Prevent gaming the system with multiple requests:
- **Enable Diminishing Returns** (`objective.enable_diminishing_returns`): Reduce weight for multiple requests
- **First Request Multiplier** (`objective.first_request_multiplier`): Weight for first request (1-20)
- **Second Request Multiplier** (`objective.second_request_multiplier`): Weight for second request (1-20)
- **Third+ Request Multiplier** (`objective.third_plus_request_multiplier`): Weight for additional requests (1-20)

### 4. Solver Settings
Technical solver configuration:

#### Friend Group Splitting
- **Split Threshold** (`solver.friend_group.split_threshold`): Size to trigger splitting (6-14)
- **Split Strategy** (`solver.friend_group.split_strategy`): "balanced" or "sequential"
- **Min Subgroup Size** (`solver.friend_group.min_subgroup_size`): Minimum size after split (2-8)

#### Debug Settings
- **Debug Enabled** (`solver.debug.enabled`): Enable detailed logging
- **Log Level** (`solver.debug.log_level`): "INFO", "DEBUG", or "WARNING"

#### Solver Behavior
- **Auto-Apply Results** (`solver.auto_apply_enabled`): Automatically apply results without confirmation
- **Auto-Apply Delay** (`solver.auto_apply_timeout`): Seconds to wait before applying (0-30)
- **Execution Mode** (`solver.execution_mode`): "unified" (all sessions) or "per_session" (independent)

## Accessing Configuration

### Admin Panel (/admin)
The Admin panel provides full access to all configuration values:
1. Navigate to Admin tab → Solver Configuration section
2. All 48 configuration values are displayed by category
3. Click any value to edit inline
4. Changes save automatically
5. Use "Reset to Defaults" to restore all values

### Settings Page (/settings)
The Settings page provides a user-friendly interface for bunking team:
1. Navigate to Settings in the main menu
2. Configurations are organized into logical sections
3. Use sliders for priorities and multipliers
4. Toggle switches for boolean settings
5. Tooltips explain each setting
6. Individual save buttons for each change
7. "Reset to Defaults" available at the top

## Configuration Synchronization

The configuration system maintains consistency across multiple layers:

### Database Storage
All configurations are stored in the `solver_config` PocketBase collection with:
- `config_key`: Unique identifier (e.g., "priority.age_preference.default")
- `config_value`: String representation of the value
- `description`: Human-readable description
- `category`: One of: priority, constraint, objective, solver
- `data_type`: integer, float, boolean, or string
- `min_value`/`max_value`: Valid ranges for numeric values

### Configuration Initialization
Configuration initialization is now handled natively by PocketBase during startup:
- All required configs are created automatically when PocketBase starts
- Only missing configs are created - existing values are never overwritten
- Default values and metadata are defined in `pocketbase/config/config_init.go`

### Configuration Sources
1. **DEFAULT_CONFIG** in `config_service.py`: Source of truth for runtime access
2. **Config initialization** in `pocketbase/config/config_init.go`: Creates missing configs on startup
3. **Database**: Runtime storage with user modifications
4. **API**: Serves current values to frontend

## API Endpoints

### GET /solver-settings
Retrieve all solver configuration values grouped by category.

**Response:**
```json
{
  "priority": [
    {
      "id": "abc123",
      "key": "priority.age_preference.default",
      "value": "10",
      "description": "Default priority for age preference requests",
      "data_type": "integer",
      "min_value": 1,
      "max_value": 10,
      "updated": "2025-07-12T05:14:18"
    }
  ],
  "constraint": [...],
  "objective": [...],
  "solver": [...]
}
```

### PUT /solver-settings/{key}
Update a specific configuration value.

**Request:**
```json
{
  "value": "8"
}
```

**Response:**
```json
{
  "id": "abc123",
  "key": "priority.age_preference.default",
  "value": "8",
  "description": "Default priority for age preference requests",
  "category": "priority",
  "data_type": "integer",
  "min_value": 1,
  "max_value": 10,
  "updated": "2025-07-12T05:22:24"
}
```

### POST /solver-settings/reset
Reset all configuration values to defaults.

**Response:**
```json
{
  "message": "Successfully reset 15 configuration values to defaults",
  "updated_count": 15
}
```

## Best Practices

### For Administrators
1. **Test Changes**: Use scenario planning to test configuration changes before production
2. **Document Changes**: Keep notes on why configurations were changed
3. **Monitor Results**: Check solver run metrics after changes
4. **Incremental Adjustments**: Make small changes and observe effects

### For Bunking Teams
1. **Understand Priorities**: Higher values (8-10) mean requests are much more likely to be satisfied
2. **Balance Constraints**: Too many hard constraints can make problems unsolvable
3. **Use Multipliers Carefully**: Source multipliers affect all requests from that source
4. **Review Defaults**: Default values are based on camp best practices

### Configuration Guidelines
1. **Priority Values (1-10)**:
   - 1-3: Low priority, often ignored
   - 4-6: Normal priority, balanced consideration
   - 7-9: High priority, usually satisfied
   - 10: Maximum priority, almost always satisfied

2. **Penalty Weights (0-10000)**:
   - 0: Constraint disabled
   - 1-100: Minor preference
   - 100-1000: Strong preference
   - 1000-10000: Near-hard constraint

3. **Multipliers (0.1-5.0)**:
   - 0.1-0.5: Much less important
   - 0.6-0.9: Somewhat less important
   - 1.0: Normal importance
   - 1.1-2.0: More important
   - 2.1-5.0: Much more important

## Troubleshooting

### Common Issues

#### "Configuration not updating"
- Check if value is within min/max range
- Verify data type matches (integer vs float)
- Ensure you have admin permissions

#### "Solver ignoring configuration"
- Some configs only apply in specific modes
- Check if related constraints are enabled
- Review solver debug logs for details

#### "Reset not working"
- Reset only affects values different from defaults
- Check DEFAULT_CONFIG for actual default values
- Sync script may need to run after changes

### Migration Issues

If PocketBase migrations fail to update enum values:
1. Stop the development server
2. Run the fix script:
   ```bash
   ./scripts/fix_objective_category_enum.py
   ```
3. Restart the server
4. Run the sync script

## Development

### Adding New Configuration

1. Add to `DEFAULT_CONFIG` in `config_service.py` for runtime access:
   ```python
   "category.subcategory.name": default_value,
   ```

2. Add to Go config initialization in `pocketbase/config/config_init.go`:
   - Add to `DefaultConfig` map with default value
   - Add to `ConfigMetadataMap` with metadata (description, category, data_type, min/max values)

3. Update frontend `VALID_CONFIG_KEYS` in `AdminConfig.tsx`

4. Add to appropriate section in `Settings.tsx` if user-facing

5. Rebuild PocketBase to include new configuration

### Testing Configuration Changes

1. Unit tests in `test_config_service.py`
2. Integration tests with solver runs
3. Scenario planning for real-world testing
4. Performance impact analysis

## Security Considerations

- Configuration changes require admin authentication
- All changes are logged for audit trail
- No sensitive data in configuration values
- API endpoints should be protected in production
- Regular backups of configuration state

## Related Documentation

- [Solver API](../api/solver-api.md) - Complete API reference