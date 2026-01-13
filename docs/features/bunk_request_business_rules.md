# Bunk Request Processing Business Rules

This document defines the correct behavior for the bunk request processing system.

## Request Types

### 1. bunk_with
- **Purpose**: Positive bunking request - camper wants to bunk with specific person(s)
- **Requirements**: Must have target name that can be resolved to a camper
- **Sources**: Can come from any field (family, staff, notes)

### 2. not_bunk_with
- **Purpose**: Negative bunking request - camper should NOT bunk with specific person(s)
- **Requirements**: Must have target name that can be resolved to a camper
- **Sources**: Can come from family or staff fields

### 3. age_preference
- **Purpose**: Preference for bunking with older or younger campers
- **Values**: "older" or "younger" only
- **Requirements**: No target name needed
- **Sources**: Typically from ret_parent_socialize_with_best field

## Request Sources

### parent
- **Field**: `ret_parent_socialize_with_best`
- **Purpose**: Parent's socialization preference
- **Typical Type**: age_preference

### family
- **Field**: `share_bunk_with`
- **Purpose**: Family's direct bunking requests
- **Typical Types**: bunk_with, not_bunk_with, age_preference

### staff
- **Field**: `do_not_share_bunk_with`
- **Purpose**: Staff safety/exclusion requests
- **Typical Type**: not_bunk_with

### staff-notes
- **Fields**: `internal_notes`, `bunking_notes`
- **Purpose**: Staff observations, parent phone calls, historical notes
- **Typical Types**: Any type based on context

## Priority System (1-4 Scale)

### Priority 4 (Highest)
1. **bunk_with** from family field:
   - First in ordered list (when no priority keywords exist)
   - Any with priority keywords (when keywords exist anywhere)
2. **not_bunk_with** from family field
3. **not_bunk_with** from staff field
4. **age_preference** from family field (only when it's the sole request)
5. **LAST_YEAR_BUNKMATES** (only when no other specific bunk_with exists)

### Priority 3
1. **bunk_with** from family field (subsequent in list without keywords)
2. **LAST_YEAR_BUNKMATES** (when other specific bunk_with exists)

### Priority 2
1. Any request type from staff notes fields

### Priority 1 (Lowest)
1. **age_preference** from family field (when other requests exist)
2. **age_preference** from parent field (always)

## Priority Keywords
When these appear in request text, the request is considered high priority:
- "must have"
- "very important"
- "top priority"
- "essential"
- "critical"
- "urgent"
- "first choice"
- "most important"

**Rule**: If ANY request in a family's list has priority keywords, assume the list is unordered and only keyword requests get priority 4.

## Session Compatibility

### Exact Session Matching
- Requests are only valid within the EXACT SAME session
- Cannot bunk across session families (e.g., Session 2a cannot bunk with Session 2b)
- Session mapping:
  ```
  1000001: Taste of Camp
  1000002: Session 2 (main)
  1000021: Session 2a
  1000022: Session 2b
  1000023: AG 2 (9-10)
  1000024: AG 2 (7-9)
  1000003: Session 3 (main)
  1000031: Session 3a
  1000033: AG 3
  1000004: Session 4 (main)
  1000043: AG 4
  ```

## Self-Referential Detection

### What IS Self-Referential
1. Requester CM ID = Requested CM ID
2. Requester full name = Target name AND no CM ID could be resolved

### What is NOT Self-Referential
1. Only first names match (could be different camper)
2. Names match but different CM IDs resolved
3. Similar but not exact name matches

## Special Request Handling

### LAST_YEAR_BUNKMATES
- Creates ONE placeholder request (not individual requests)
- Status: "pending" for staff review
- Priority: 4 if sole request, 3 if other specific requests exist
- Purpose: Flag for staff to review prior year arrangement

### Request Status Values
- **resolved**: Successfully processed (name resolved, validation passed)
- **pending**: Needs manual review (placeholders, low confidence, conflicts)
- **declined**: Cannot be processed (cross-session, invalid, manually rejected)

## Name Resolution

### Resolution Methods (in order)
1. **Exact Match**: 100% confidence
2. **Nickname Match**: 90% confidence (e.g., Johnny → John)
3. **Fuzzy Match**: 80% confidence (minor typos)
4. **Phonetic Match**: 70% confidence (sounds alike)
5. **School Disambiguation**: Confidence boost if same school
6. **Social Graph**: Use mutual connections for disambiguation
7. **AI Assisted**: Last resort for ambiguous cases

### Context Optimization
- Pre-filter candidates by exact session
- Further filter by age (±36 months) when possible
- Limit to top 10 candidates for AI disambiguation
- Include social signals when available

## Validation Rules

### Required Validations
1. No self-referential requests
2. Same exact session only
3. Target name required for bunk_with/not_bunk_with
4. No duplicate requests for same pair
5. Valid request type for source field

### Automatic Corrections
1. Remove duplicate requests (keep highest priority)
2. Convert invalid cross-session requests to "declined"
3. Flag low confidence matches for review

## CSV Processing

### Field Processing Order
1. Process each field independently
2. Collect all requests for a person
3. Apply deduplication rules
4. Calculate priorities based on full context
5. Persist to database

### Position Tracking
- Track CSV position (0-based) for each request
- Used for priority when no keywords present
- Preserved in metadata for debugging