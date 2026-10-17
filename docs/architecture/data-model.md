# Data Model Architecture

## Overview

> Field lists below are a summary. The authoritative schema is `pocketbase/pb_migrations/*.js`; `docs/reference/tables.md` documents each table and `frontend/src/types/pocketbase-types.ts` is generated from it.

The data model represents a unified view of camp operations, bridging CampMinder's source data with local optimization needs. The model follows a person-centric design where all individuals (campers, staff, family) are treated uniformly.

## Core Design Principles

### 1. Person-Centric Model
- Single `persons` table for all individuals
- No separate campers/staff tables
- Relationships based on person records

### 2. CampMinder ID Primacy
- All relationships use CampMinder IDs
- PocketBase IDs are internal only
- Ensures data integrity across syncs

### 3. Year-Based Partitioning
- All temporal data includes year field
- Historical data isolated from current year
- Enables multi-year analysis

### 4. Soft Delete Pattern
- `is_active` field for logical deletes
- Preserves historical relationships
- Allows data recovery

## Entity Relationship Diagram

```text
persons (1) ----< (N) attendees (N) >---- (1) sessions
   |                      |                       |
   |                      |                       |
   |                      v                       |
   |                   year field                 |
   |                                              |
   v                                              v
bunk_assignments (N) >---- (1) bunks (N) <---- (1) bunk_plans
        |                        |
        |                        v
        |                    divisions
        v
    year field
```

## Core Entities

### Persons
**Purpose**: Master record for all individuals

Key Fields:
- `cm_id` (number): CampMinder person ID
- `year` (number): persons rows are year-scoped, one per person per season
- `first_name`, `last_name`, `preferred_name`: Basic identification
- `birthdate`, `age`: For age calculations (`age` is a snapshot, not recomputed)
- `is_camper`: Camper vs. other person in the household
- `gender`, `grade`, `school`: For bunking constraints and matching
- `household_id` and the childhood-household fields: Family linkage
- `years_at_camp`, `last_year_attended`: Attendance history

### Sessions
**Purpose**: Camp session periods

Key Fields:
- `cm_id`: CampMinder session identifier (CampMinder reuses these across years)
- `name`: Display name (e.g., "Session 2")
- `year`: Camp season
- `start_date`, `end_date`: Session boundaries
- `session_type`: Type classification (`main`, `embedded`, `ag`, `family`, `family_adult`, `quest`, `scit`, `bmitzvah`, `tli`, `adult`, `school`, `hebrew`, `teen`, `other`)
- `parent_id`: Parent session for embedded and AG sessions
- `is_active`: Whether currently offered

Session Types:
- **Taste of Camp**: 1-week introductory session for new campers
- **Main Sessions** (2, 3, 4): Full multi-week summer sessions
- **Embedded Sessions** (2a, 2b, 3a): Partial turnover periods where some campers stay, others change
- **All-Gender Sessions**: Parallel sessions using only AG-prefixed bunks
- **Family Camp / Adult Reg weekends** (`family`, `family_adult`, `adult`): Excluded from bunking optimization; housed through the lodging board (`docs/architecture/session-types.md`)

### Divisions
**Purpose**: Age/grade groupings

Key Fields:
- `cm_id`: CampMinder division identifier
- `name`: Display name (e.g., "Ofarim")
- `gender_id`: Gender-specific divisions
- `start_grade_id`, `end_grade_id`: Grade range
- `capacity`, `parent_division`, `staff_only`, `assign_on_enrollment`
- Global lookup: no `year` field

### Bunks
**Purpose**: Physical cabin entities

Key Fields:
- `cm_id`: CampMinder bunk identifier
- `name`: Bunk name (e.g., "O1")
- `year`: Camp season
- `gender`: `M`, `F`, `Mixed` or AG
- `area_id`, `sort_order`
- `is_active`: Whether available
- Capacity is not stored on the bunk; the solver applies its configured cabin capacity (12, overflowing to 13)

## Relationship Entities

### Attendees
**Purpose**: Links persons to sessions they're attending

Key Fields:
- `person_id` (number): Person's CampMinder ID (with a `person` relation to `persons`)
- `session` (relation to `camp_sessions`)
- `year` (int): Attendance year
- `status_id`: Enrollment status (the solver treats `2` as active enrolled)
- `enrollment_date`, `effective_date`: Registration timing (`effective_date` is the registration date, and holds through ordinary status changes; CampMinder bulk actions overwrite it, see `campminder-date-fields.md`)
- Unique index on (`person_id`, `year`, `session`)

### Bunk Plans
**Purpose**: Which bunks are available for which sessions

Key Fields:
- `session`, `bunk` (relations)
- `cm_id`, `code`, `name`: The CampMinder plan identity
- `year` (int): Plan year
- `is_active`: Whether this pairing is active
- Unique index on (`year`, `bunk`, `session`, `cm_id`)

### Bunk Assignments
**Purpose**: Actual cabin placements

Key Fields:
- `person`, `bunk`, `session`, `bunk_plan` (relations)
- `cm_id`: CampMinder assignment ID
- `year` (int): Assignment year
- Unique index on (`year`, `person`, `session`, `bunk`)
- `bunk_assignments` mirrors CampMinder and is **read-only for the solver and drag/drop**; planning happens in `bunk_assignments_draft`, keyed by `scenario` (a `saved_scenarios` record) and carrying `assignment_locked`

## Supporting Entities

### Bunk Requests
**Purpose**: Camper pairing preferences

Key Fields:
- `requester_id`, `requestee_id`: CampMinder IDs of who asked and who they named
- `request_type`: `bunk_with`, `not_bunk_with` or `age_preference`
- `source_field` / `source_fields`: Which input channel(s) produced it (`docs/architecture/request-classification.md`)
- `session_id`, `year`
- `status`: Resolution state, plus confidence and manual-review fields
- `is_reciprocal`, `is_first_requested`

### Person Tags
**Purpose**: Flexible tagging system

Key Fields:
- `person_tag_defs`: Global tag definitions
- `persons.tags`: The tags a person carries, per year
- Examples: specialty programs, dietary needs

### Historical Attendance
There is no separate history table. The `camper_history` table was dropped (#2369); prior-year attendance and bunking are read directly from year-scoped `attendees`, `persons` and `bunk_assignments` rows.

## Data Integrity Rules

### 1. Referential Integrity
- All foreign keys use CampMinder IDs
- Cascading updates not used (explicit handling)
- Orphan detection in sync process
- **CRITICAL**: All relationships between CampMinder-sourced data MUST use CampMinder IDs
- PocketBase IDs are internal only - never use for cross-table relationships
- Where a table carries both a PocketBase relation and a CampMinder ID column (`attendees.person` / `attendees.person_id`), cross-table logic and joins key on the CampMinder ID; the relation field is for PocketBase `expand` only

### 2. Temporal Integrity
- Year fields required on temporal data
- No cross-year references allowed
- Historical data immutable

### 3. Business Rules
- One person per bunk per session
- Bunk capacity constraints
- Gender-division matching
- Age-appropriate divisions

### 4. Audit Trail
- Created/updated timestamps
- User tracking where applicable
- Change history via PocketBase

## Performance Considerations

### Indexes
- CampMinder IDs indexed
- Year fields indexed
- Composite indexes for unique constraints

### Query Patterns
- Filter by year first
- Use CampMinder IDs for joins
- Avoid cross-year queries

### Data Volume
- ~5,000 persons
- ~10 sessions per year
- ~100 bunks
- ~2,000 attendees per session

## Evolution Strategy

### Schema Versioning
- PocketBase migrations
- Backward compatibility
- Gradual transitions

### Field Additions
- New fields nullable initially
- Backfill via sync updates
- Required after migration

### Deprecation Process
- Mark fields deprecated
- Maintain for full season
- Remove in off-season

For implementation details, see the PocketBase migrations in `pocketbase/pb_migrations/`.