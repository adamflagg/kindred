# Data Model Architecture

## Overview

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

```
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
- `campminder_id` (string): Unique CampMinder identifier
- `first_name`, `last_name`: Basic identification
- `display_name`: Computed friendly name
- `birthdate`: For age calculations
- `person_type`: Enum (Camper, Staff, Family Member)
- `gender`: For bunking constraints
- `years_at_camp`: Array of attended years
- `is_active`: Soft delete flag

### Sessions
**Purpose**: Camp session periods

Key Fields:
- `campminder_id`: Unique session identifier
- `name`: Display name (e.g., "Session 1 2025")
- `year`: Calendar year
- `start_date`, `end_date`: Session boundaries
- `session_type`: Type classification
- `is_active`: Whether currently offered

Session Types:
- **Taste of Camp**: 1-week introductory session for new campers
- **Main Sessions** (2, 3, 4): Full multi-week summer sessions
- **Embedded Sessions** (2a, 2b, 3a): Partial turnover periods where some campers stay, others change
- **All-Gender Sessions**: Parallel sessions using only AG-prefixed bunks
- **Family Camp**: Excluded from bunking optimization by default

### Divisions
**Purpose**: Age/grade groupings

Key Fields:
- `campminder_id`: Unique division identifier
- `name`: Display name (e.g., "Ofarim")
- `display_name`: Friendly display name
- `gender`: Gender-specific divisions
- `min_grade`, `max_grade`: Grade range
- `display_order`: UI sorting

### Bunks
**Purpose**: Physical cabin entities

Key Fields:
- `campminder_id`: Unique bunk identifier
- `name`: Bunk name (e.g., "O1")
- `division`: Reference to division (CampMinder ID)
- `capacity`: Maximum occupancy
- `min_capacity`: Minimum for viability
- `is_active`: Whether available

## Relationship Entities

### Attendees
**Purpose**: Links persons to sessions they're attending

Key Fields:
- `person` (string): Person's CampMinder ID
- `session` (string): Session's CampMinder ID
- `year` (int): Attendance year
- `division` (string): Assigned division
- `age` (int): Age during session
- `grade` (int): Grade during session
- Unique constraint on (person, session, year)

### Bunk Plans
**Purpose**: Which bunks are available for which sessions

Key Fields:
- `session` (string): Session's CampMinder ID
- `bunk` (string): Bunk's CampMinder ID
- `year` (int): Plan year
- `is_active`: Whether this pairing is active
- Unique constraint on (session, bunk, year)

### Bunk Assignments
**Purpose**: Actual cabin placements

Key Fields:
- `person` (string): Person's CampMinder ID
- `bunk` (string): Bunk's CampMinder ID
- `session` (string): Session's CampMinder ID
- `year` (int): Assignment year
- `assignment_type`: Manual vs solver-generated
- `created_by`: Audit trail
- Unique constraint on (person, session, year)

## Supporting Entities

### Bunk Requests
**Purpose**: Camper pairing preferences

Key Fields:
- `requester_cm_id`: Who made the request
- `requested_cm_id`: Who they want to bunk with
- `year`: Request year
- `status`: Pending/approved/denied
- `mutual`: Whether reciprocated

### Person Tags
**Purpose**: Flexible tagging system

Key Fields:
- `person`: Person's CampMinder ID
- `tag`: Tag identifier
- `year`: When tag applies
- Examples: specialty programs, dietary needs

### Historical Bunking
**Purpose**: Simplified historical attendance

Key Fields:
- `person_cm_id`: Person identifier
- `year`: Historical year
- `session_name`: Which session
- `division_name`: Their division
- `bunk_name`: Their bunk (if known)

## Data Integrity Rules

### 1. Referential Integrity
- All foreign keys use CampMinder IDs
- Cascading updates not used (explicit handling)
- Orphan detection in sync process
- **CRITICAL**: All relationships between CampMinder-sourced data MUST use CampMinder IDs
- PocketBase IDs are internal only - never use for cross-table relationships
- Example: `bunk_assignments.person` links to `persons.campminder_id`, not `persons.id`

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