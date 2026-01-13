# Bunking Request Types Specification

This document serves as the authoritative reference for how bunking requests are processed in Kindred. It defines the five core request types, their sources, processing rules, and integration points.

## Overview

The bunking intelligence system processes natural language requests from multiple CSV fields and converts them into structured, prioritized constraints for the optimization solver. The system uses OpenAI GPT-4 for parsing with type-specific confidence scoring.

## Request Types

### 1. `bunk_with` - Positive Bunking Requests

**Definition**: A direct request for two specific people to be placed in the same bunk.

**Sources**:
- **Primary**: `share_bunk_with` field (CSV column: "Share Bunk With")
  - Parent-provided comma or newline separated list
  - List position determines priority (1st = highest)
  - Example: "Sarah Johnson, Emma Smith, Lily Chen"
- **Secondary**: `bunking_notes` field (CSV column: "BunkingNotes Notes")
  - Only when explicitly requesting bunking (not observations)
  - Valid: "Parent called - wants child with Sarah from last year"
  - Invalid: "Enjoys playing with Sarah" (observation, not request)
  - Often includes attribution: "NOAH GOROVITZ (May 1 2023 2:25PM)"

**Processing Rules**:
- Each name becomes a separate request
- Priority calculation:
  - Position 1: Priority 10
  - Position 2: Priority 9
  - Position 3: Priority 8
  - ... down to Position 10: Priority 1
  - Keywords can override (#1, must be with = Priority 10)
- Name resolution required with confidence scoring
- Staff notes require explicit request language

**Deduplication**:
- Same person requested multiple times: keep highest priority/confidence
- Parent request + counselor confirmation: keep parent request, boost confidence
- Different sources same target: merge with source tracking

**Reciprocal Detection**:
- If A→B and B→A exist: mark both as `is_reciprocal = true`
- Reciprocal requests get 5% confidence boost

**Solver Usage**:
- Priority 8-10: Hard constraints
- Priority 4-7: Soft constraints with weight
- Priority 1-3: Preference hints
- Reciprocal requests prioritized

### 2. `not_bunk_with` - Negative Bunking Requests

**Definition**: A request to keep two specific people in different bunks.

**Sources**:
- **Primary**: `do_not_share_with` field (CSV column: "Do Not Share Bunk With")
  - Parent-provided list of incompatible campers
  - Example: "Jake Miller, Tom Wilson"
- **Secondary**: `bunking_notes` field
  - Staff recommendations and historical issues
  - Example: "Had significant conflict with Jake last summer - counselors recommend separation"
  - Example: "COUNSELOR NOTE: Do not place with Tom - ongoing behavioral issues"

**Processing Rules**:
- Same name resolution as bunk_with
- Staff recommendations create high priority (8-10)
- Historical issues documented for context
- Never ignored even if not reciprocal

**Conflict Detection**:
- If A→B (positive) exists and B→A (negative) exists:
  - Create conflict record with `conflict_group_id`
  - Both requests marked for manual review
  - Recent "spoke to family" note can auto-resolve with 90%+ confidence
- Conflicting staff vs parent: staff takes precedence for negative requests

**Deduplication**:
- Counselor recommendations override parent requests
- Authority hierarchy: counselor > historical > parent
- Keep most authoritative source

**Solver Usage**:
- Always hard constraints
- Never violated unless physically impossible
- Can be overridden by spread constraints if necessary

### 3. `age_preference` - Age/Grade Preferences (Unified)

**Definition**: Request for camper to be placed with older, younger, or same-age peers.

**Sources & Priorities**:
- **High Priority (8-10)**: Explicit text in `share_bunk_with`
  - "Please place with kids his own age"
  - "Prefers to be with older campers"
  - "Same grade only please"
- **High Priority (8-10)**: Explicit text in `do_not_share_with`
  - "Not with younger kids"
  - "No one more than a grade below"
- **Medium Priority (5)**: `socialize_preference` field (CSV: "RetParent-Socializewithbest")
  - Only these exact values:
    - "Kids their own grade and one grade above" → "older"
    - "Kids their own grade and one grade below" → "younger"
    - "" (empty) → no preference
- **Medium Priority (5)**: Staff observations in `bunking_notes`
  - "Very mature for age - does better with older kids"
  - "Counselors note: socially young, place with younger group"

**Processing Rules**:
- Extract preference direction: "older", "younger", "same"
- Track source in `source_detail` field for priority differentiation
- No name resolution needed
- Pure AI parsing confidence

**Deduplication**:
- Only one age preference per person per session
- Highest priority source wins
- Explicit overrides social preferences

**Solver Usage**:
- Influences bunk allocation by age/grade distribution
- Determines placement in grade splits (e.g., 5+6 vs 6+7 bunk)
- Soft constraint that yields to hard constraints

### 4. `prior_year_continuity` - Keep Last Year's Group

**Definition**: Request to maintain bunking arrangements from the previous year.

**Sources**:
- **Primary**: Pattern detection in `share_bunk_with`
  - General: "Same bunk as last year please"
  - Specific: "Keep together from last year: Sarah, Emma, Lily"
- **Secondary**: `bunking_notes` historical references
  - "Parents requested continuity from 2024 bunk group"

**Processing Rules**:
- **Specific Names**:
  - Attempt smart match for each name
  - Verify they were together last year
  - Create both `bunk_with` and continuity requests
  - Unmatched names → manual review with dropdown
- **General Request**:
  - Query `bunk_assignments` with `year < currentYear` filter
  - Find all campers from requester's previous bunk
  - Check current year attendance
  - Auto-create low priority requests for attending kids
  - Store in `attending_kids_from_prior_year` field

**Manual Review UI**:
- Show dropdown of last year's bunkmates
- Display attendance status for each
- Allow quick request creation
- Option to reject if group incompatible

**Deduplication**:
- Specific names create dual requests (continuity + bunk_with)
- General continuity doesn't duplicate individual requests
- Prior year + current year explicit = priority boost

**Solver Usage**:
- Priority 8 for specific continuity requests
- Priority 3-5 for general continuity
- Lower than current year explicit requests
- Fails gracefully if some didn't return

### 5. `spread_limited` - Cannot Fulfill Due to Spread Constraints

**Definition**: System-generated type for requests that violate age/grade spread limits.

**Generation Triggers**:
- Grade difference > 2 grades
- Age difference > 25 months
- Detected during request processing

**Processing Rules**:
- Original request preserved in `original_text`
- Converted from `bunk_with` to `spread_limited`
- Automatic manual review flag
- High confidence (100%) as system-generated

**Parent Communication**:
- Clear explanation in `parse_notes`
- Shows why request cannot be honored
- Suggests alternatives if possible

**Solver Usage**:
- Never sent to solver
- Used for reporting and communication
- Helps explain unmet requests

## Confidence Scoring

### Type-Specific Calculations

```python
# bunk_with: Name resolution critical
if request_type == 'bunk_with':
    # Weights: name (70%), AI (15%), context (10%), reciprocal (5%)
    
# not_bunk_with: Name + authority  
elif request_type == 'not_bunk_with':
    # Weights: name (60%), AI (25%), authority (15%)
    
# age_preference: Pure AI parsing
elif request_type == 'age_preference':
    # Weight: AI parsing (100%)
    
# prior_year_continuity: Historical verification
elif request_type == 'prior_year_continuity':
    # Weights: historical (40%), names if specific (40%), AI (20%)
    
# spread_limited: System generated
elif request_type == 'spread_limited':
    # Always 100% confidence
```

### Confidence Thresholds
- **95%+**: Auto-accept, no review needed
- **90-94%**: Valid with spot check
- **85-89%**: Valid but flagged
- **70-84%**: Manual review required
- **<70%**: Reject or extensive review

## Integration Flow

### Processing Pipeline
1. **CSV Import**: All fields parsed simultaneously by AI
2. **Type Detection**: AI identifies request types from natural language
3. **Name Resolution**: Match names to person IDs with confidence
4. **Conflict Detection**: Identify opposing requests
5. **Deduplication**: Smart merging based on type rules
6. **Priority Calculation**: Config-driven with overrides
7. **Confidence Scoring**: Type-specific relevance
8. **Manual Review**: Flag low confidence/conflicts
9. **Solver Submission**: Convert to constraints
10. **Result Tracking**: Monitor satisfaction

### Database Fields

**bunk_requests table**:
- `request_type`: enum of 5 types
- `source_field`: which CSV field it came from
- `source_detail`: additional context (e.g., "explicit" vs "social" for age_preference)
- `conflict_group_id`: links conflicting requests
- `attending_kids_from_prior_year`: JSON array for continuity
- `is_reciprocal`: boolean for mutual requests
- `spread_violation_details`: JSON with grade/age differences

## Testing Requirements

### Unit Tests
- Type detection accuracy
- Name resolution with various formats
- Confidence calculations per type
- Deduplication logic
- Conflict detection scenarios

### Integration Tests
- Full CSV processing pipeline
- Solver constraint generation
- Manual review workflow
- Historical data queries

### Test Data
- Mock CSVs with all request types
- Edge cases (misspellings, nicknames)
- Conflict scenarios
- Historical bunking data

## Frontend Display

### Request Type Labels
- `bunk_with`: "Bunk Together"
- `not_bunk_with`: "Keep Apart"
- `age_preference`: "Age/Grade Preference"
- `prior_year_continuity`: "Keep Last Year's Group"
- `spread_limited`: "Invalid - Age Spread"

### Visual Indicators
- Reciprocal: ↔️
- One-way: →
- Conflict: ⚠️
- High confidence: Green
- Medium confidence: Yellow
- Low confidence: Red

### Review Panel Features
- Type filtering
- Confidence threshold slider
- Source field display
- Conflict grouping
- Prior year dropdown
- Bulk actions

## Configuration

### AI Config (`config/ai_config.json`)
```json
{
  "request_types": ["bunk_with", "not_bunk_with", "age_preference", "prior_year_continuity", "spread_limited"],
  "confidence_thresholds": {
    "auto_accept": 0.95,
    "valid_check": 0.90,
    "valid": 0.85,
    "manual_review": 0.70
  },
  "priority_defaults": {
    "bunk_with": {
      "parent_explicit": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      "staff_explicit": 8
    },
    "not_bunk_with": {
      "parent": 7,
      "counselor": 9,
      "historical": 8
    },
    "age_preference": {
      "explicit_text": 9,
      "form_field": 5,
      "staff_observation": 5
    },
    "prior_year_continuity": {
      "specific_names": 8,
      "general": 5
    }
  }
}
```

## Performance Optimization

### Batch Processing
- Process 10-20 CSV rows per AI call
- Reduces API calls from 1200 to ~60-120
- Parallel name resolution
- Cached historical queries

### Caching Strategy
- Person name lookups
- Historical bunk assignments  
- Session attendance data
- Previous year relationships

## Version History

- **v2.0** (Current): Unified 5-type system with enhanced conflict detection
- **v1.0**: Initial 6-type system with separate age preferences

---

Last Updated: 2025-01-02
Author: Kindred