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

## First-Pick Flag (`is_first_requested`)

The legacy 1-4 priority scale and the `priority` / `priority_locked` columns were
deleted in #1455. A single boolean flag, `is_first_requested`, now identifies
the family's first-pick request. Source-field weighting and request-type
weighting live in the solver objective, not on the request row.

### When `is_first_requested` is True
Set by `bunking/sync/bunk_request_processor/processing/first_request_detector.py`:

1. The request's `csv_position == 1` within its source field (first in an
   ordered list — see `bunking/sync/bunk_request_processor/core/models.py`
   for the position convention), **OR**
2. The request text contains a priority keyword (see below).

If ANY request in a family's list contains a priority keyword, the list is
treated as unordered: only keyword-bearing requests are first-pick. Otherwise
the first request in CSV order is first-pick.

`is_first_requested` is only meaningful for family-sourced positive requests
(`bunk_with` from the family field). Other request types (`not_bunk_with`,
`age_preference`, staff-sourced requests) leave the flag False.

### Priority Keywords
When any of these appear in request text, the request becomes first-pick:
- "must have"
- "very important"
- "top priority"
- "essential"
- "critical"
- "urgent"
- "first choice"
- "most important"

### How the solver uses the flag
At most one satisfied request per camper gets the slot-0 multiplier
(`FIRST_REQUEST_MULTIPLIER = 10` in `bunking/solver/direct_solver.py`).
Request weighting beyond slot-0 is source-field-driven, not priority-driven.

## Session Compatibility

### Exact Session Matching
- Requests are only valid within the EXACT SAME session
- Cannot bunk across session families (e.g., Session 2a cannot bunk with Session 2b)
- Session mapping:
  ```text
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
- `is_first_requested` is True iff no other specific `bunk_with` request exists
  for the camper in this session (so prior-year continuity gets the slot-0
  boost only when there's no explicit first pick to compete with)
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
1. Remove duplicate requests (keep the one with `is_first_requested=True` if
   any; otherwise keep the highest-confidence row)
2. Convert invalid cross-session requests to "declined"
3. Flag low confidence matches for review

## CSV Processing

### Field Processing Order
1. Process each field independently
2. Collect all requests for a person
3. Apply deduplication rules
4. Compute `is_first_requested` per request (first-position OR priority keyword)
5. Persist to database

### Position Tracking
- Track CSV position (1-based) for each request
- Position 1 → first-pick candidate (see `is_first_requested` rules)
- Preserved in metadata for debugging