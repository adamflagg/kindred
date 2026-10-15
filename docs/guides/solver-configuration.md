# Solver Configuration Guide

This guide covers how the solver is configured: the few knobs that are tunable at runtime through the admin interface, and the constants that are deliberately hardcoded.

## Overview

Solver behavior comes from two places:

- **Runtime config**: rows in the PocketBase `config` table, read through `ConfigLoader` (`bunking/config/loader.py`). Every valid key is declared in `CONFIG_SCHEMA` (`bunking/config/schema.py`); an unknown key is rejected and a required key missing from the database is an error, because there are no hardcoded fallbacks for them.
- **Hardcoded constants**: `bunking/solver/constants.py`. These started life as config keys, but none was ever tuned at runtime, so each was collapsed into a constant (the `solver-config-it` cleanup). Changing one is a code change and a PR.

Do not add a knob to expose a number nobody will tune. The cleanup deleted most of the original surface on purpose.

## Runtime Configuration Keys

Authoritative list: `CONFIG_SCHEMA`. As of this writing the solver-facing keys are:

### Request weighting (objective)
- **Source multipliers**: `objective.source_multipliers.share_bunk_with`, `.do_not_share_with`, `.bunking_notes`, `.internal_notes`, `.socialize_preference` (float, 0.0-10.0). Each request's source selects one of these through the request registry (`docs/architecture/request-classification.md`); a source with no key (admin-UI `manual`) uses 1.0.
- **First-pick boost**: `objective.enable_first_boost` (0 or 1). When on, the request flagged `is_first_requested` takes slot 0 of the diminishing-returns stack and gets the first-pick boost.
- **Mutual boost**: `objective.mutual_request_boost` (float, 1.0-10.0). Multiplier on `bunk_with` requests filed in both directions; 1.0 turns it off. It stacks with the source multiplier.

### Cabin shape
- **Age spread bonus**: `constraint.age_spread.preferred_bonus` (int). Bonus for cabins within the preferred age spread. The 24-month cap itself is hard and hardcoded.
- **Level progression**: `constraint.level_progression.no_regression` (0 or 1) and `constraint.level_progression.no_regression_penalty` (int). Discourage moving a returning camper to a lower-level cabin.
- **Minimum occupancy**: `constraint.cabin_minimum_occupancy.penalty` (int). Penalty for a cabin below the preferred occupancy.

### Applying results
- `solver.auto_apply_enabled` (0 or 1) and `solver.auto_apply_timeout` (seconds, 0 is immediate). Auto-apply still only lands in a scenario's draft assignments; production is read-only for the solver.

### Name resolution (not solver)
`smart_local_resolution.*` keys tune name resolution in the request pipeline, not the solver. They appear in the same admin screen under the Processing category.

## Hardcoded Constants

These live in `bunking/solver/constants.py` (read the file for the current values and the history of each):

| Constant | Meaning |
|----------|---------|
| `DEFAULT_BUNK_CAPACITY` (12), `MAX_BUNK_CAPACITY` (14) | Standard cabin size. With overflow allowed, unlocked bunks can reach `DEFAULT + 1` (13) |
| `MIN_BUNK_OCCUPANCY` (8), `PREFERRED_BUNK_OCCUPANCY` (10) | Occupancy thresholds for the minimum-occupancy soft constraint |
| `MAX_UNIQUE_GRADES_PER_BUNK` (2) | Grade spread: hard |
| `MAX_AGE_SPREAD_MONTHS` (24), `PREFERRED_AGE_SPREAD_MONTHS` (18), `EDGE_AGE_OVERFLOW_PENALTY` | Age spread cap (hard for middle cabins; edge cabins get a soft escape hatch) and the preferred target |
| `MAX_SINGLE_GRADE_PERCENTAGE` (67), `GRADE_RATIO_PENALTY` | Grade ratio limit and penalty |
| `AGE_GRADE_FLOW_WEIGHT` | Encourages age progression across cabin numbers |

The parent-paramount constraint (every camper with a possible Material-Parent request gets one honored) and staff/manual separation requests are hard constraints, not tunable. See `docs/architecture/solver-internals.md`.

## Accessing Configuration

### Manage > Config (`/manage/config/<category>`)
Admin only. The page reads the `config` and `config_sections` collections straight from PocketBase and groups values by the `business_category` in each row's metadata: Solver, Processing, History and General.
1. Pick a category tab (the bare `/manage/config` redirects to `/manage/config/solver`)
2. Search or scroll the section cards
3. Edit a value and save it (writes the `config` row's `value`)
4. "Reset to Defaults" writes each row's `metadata.default_value` back

There is no separate Settings page for the bunking team.

## Configuration Storage

All runtime values live in the `config` collection (migration `1500000011_config.js`):
- `category`, `subcategory`, `config_key`: the dotted key split into parts, unique together
- `value`: the stored value
- `metadata`: data type, default value, valid range and `business_category` for the GUI
- `description`: human-readable text

Create and update need admin or the `registration.manage` permission; any signed-in user can read.

### Where each fact lives
1. **`CONFIG_SCHEMA`** (`bunking/config/schema.py`): which keys are valid, their type and range. Reading an unlisted key fails.
2. **Seed migration** (`pocketbase/pb_migrations/`): creates the row with its default and metadata. A key that is in the schema but not seeded will fail a required read at startup.
3. **Database**: the live value, including admin edits.
4. **Code reads** (`ConfigLoader.get_int`, `get_float`, `get_bool`): the solver, evaluators and validator.

## Best Practices

### For Administrators
1. **Test changes in a scenario**: run the solver on a scenario before relying on a new value
2. **Document changes**: note why a value was changed
3. **Compare scores**: `GET /api/scenarios/score` gives the objective score of a scenario or production, so two settings can be compared
4. **Change one thing at a time**

### Configuration Guidelines
1. **Multipliers (0-10)**: 1.0 is neutral; below 1.0 makes a source count for less, above 1.0 for more. The weights multiply with the first-pick and mutual boosts, so small changes compound.
2. **Penalty weights**: larger means closer to a hard constraint. A penalty large enough to dominate the objective behaves like one and can make a session hard to solve.

## Troubleshooting

### "Configuration not updating"
- Check the value is within the key's range
- Check the data type matches
- Confirm you are an admin

### "Solver ignoring configuration"
- Confirm the key is in `CONFIG_SCHEMA` and read by the code path you expect (`grep` for it)
- Check whether the behavior is a hardcoded constant, not a config key
- Review the solver run log under `logs/solver/`

## Development

### Adding or removing a config key

Walk all four surfaces together; the `solver-config-it` skill does exactly this per domain:

1. Declare it in `CONFIG_SCHEMA` (`bunking/config/schema.py`)
2. Seed it with a PocketBase migration (`docs/reference/pocketbase-migrations.md`); to remove a key, a migration drops the row
3. Make sure the GUI shows it (Manage > Config picks up rows by `business_category`)
4. Read it in code with `ConfigLoader.get_*`

If a number is never going to be tuned, prefer a constant in `bunking/solver/constants.py` over a key.

### Testing Configuration Changes
1. Unit tests for the loader and schema live under `tests/unit/config/`
2. Run a solve on a scenario and compare scores
3. Performance impact: `docs/reference/objective-sensitivity.md`

## Security Considerations

- Configuration changes require admin authentication (or `registration.manage`)
- Changes go through PocketBase's `config` rules (admin or `registration.manage`)
- No sensitive data in configuration values

## Related Documentation

- [Solver API](../api/solver-api.md) - Complete API reference
- [Solver internals](../architecture/solver-internals.md) - Hard constraints, impossibility, observability
- [Request classification](../architecture/request-classification.md) - How a request's source picks its multiplier
