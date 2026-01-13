# Request Management Guide

This guide explains how to manage bunking requests in Kindred, including understanding request types, using the review dashboard, and resolving conflicts.

## Table of Contents
- [Request Processing Architecture](#request-processing-architecture)
- [Understanding Request Types](#understanding-request-types)
- [Priority System](#priority-system)
- [Request Review Dashboard](#request-review-dashboard)
- [Conflict Resolution](#conflict-resolution)
- [Prior Year Continuity](#prior-year-continuity)
- [AI Configuration](#ai-configuration)
- [Best Practices](#best-practices)

## Request Processing Architecture

The bunking request system uses a three-phase architecture to ensure accurate, deduplicated, and well-organized request processing:

### Phase 1: Collection
In this phase, all requests are collected from various sources (CSV fields, AI parsing) and stored in memory as `CollectedRequest` objects. No database operations occur during this phase.

**Key activities:**
- Parse all CSV fields using AI with comprehensive multi-field analysis
- Extract requests from multiple sources (share_bunk_with, do_not_share_with, bunking_notes, socialize_preference)
- Apply source-based deduplication (counselor recommendations override parent requests for negatives)
- Calculate initial priorities and confidence scores using multi-signal scoring
- Validate spread constraints (max 2 grades, 24 months age difference)
- Convert spread-limited requests to manual review items

**AI Processing Details:**
- AI analyzes ALL CSV fields simultaneously for comprehensive understanding
- Distinguishes between actionable requests and informational notes
- Tracks source attribution (parent vs counselor vs staff)
- Resolves names using current and historical attendee data
- Generates confidence scores based on name matching and context

### Phase 2: Processing
This phase analyzes the collected requests to detect patterns and relationships, particularly friend groups.

**Key activities:**
- Build request graph from collected data
- Detect friend groups based on reciprocal patterns
- Add friend group requests to the collection
- Apply completeness thresholds
- No database operations

### Phase 3: Persistence
In this final phase, all collected requests are deduplicated and persisted to the database in a single batch operation.

**Key activities:**
- Sort requests by priority
- Apply final deduplication
- Create database records
- Track creation statistics
- Single point of database interaction

This architecture ensures:
- **No duplicate creation**: Only one method creates database records
- **Better testing**: Each phase can be tested independently
- **Clean data flow**: Clear separation of concerns
- **Efficient processing**: Batch operations reduce database calls

## Understanding Request Types

The enhanced request system supports several types of bunking requests:

### 1. Bunk With Requests (Positive)
These are requests where a camper wants to bunk with specific other campers.

**Sources:**
- CSV "Share Bunk With" column
- Manual entries through the review dashboard

**Examples:**
- "Sarah Johnson"
- "Emma Wilson and Olivia Davis"
- "Jake from last year"

### 2. Not Bunk With Requests (Negative)
These are requests where a camper should NOT be placed with specific other campers.

**Sources:**
- CSV "Do Not Share Bunk With" column
- Manual entries through the review dashboard

**Examples:**
- "Michael Brown"
- "Anyone from cabin 7 last summer"

### 3. Age Preference Requests
These are requests for bunking with older or younger campers.

**Sources:**
- CSV "Bunk With" column containing "older" or "younger"
- socialize_with_best field from CampMinder

**Examples:**
- "older kids"
- "younger campers"
- "kids my age"

### 4. Prior Year Continuity
These are requests to maintain bunking arrangements from previous years.

**Detected phrases:**
- "last year"
- "previous summer"
- "keep together"
- "same bunk"
- "returners"

**Examples:**
- "Same kids from last year"
- "Keep our bunk together"
- "Anyone from Cabin 3 last summer"

## Priority System

Requests are assigned priorities that determine their importance in the solver:

### Priority Levels

1. **Priority 1 (Base weight: 100)**
   - Explicit CSV requests in first position
   - Prior year continuity with specific names
   - Age preferences from CSV

2. **Priority 2 (Base weight: 80)**
   - Explicit CSV requests in second position
   - Prior year continuity with any returners

3. **Priority 3 (Base weight: 30)**
   - Explicit CSV requests in third+ position
   - General preferences

### Priority Boosters

Certain keywords multiply the base priority:

- **"must be with"**: +10x multiplier
- **"#1" or "number one"**: +10x multiplier
- **Multiple occurrences**: Additive boost

### Dynamic Priority Escalation

- **socialize_with_best**: Normally low priority (1), but escalates to high priority (100) for campers with NO other requests
- **Age preferences**: Higher priority when explicitly stated in CSV vs. auto-detected

## Request Review Dashboard

The Request Review Dashboard allows staff to review and validate all bunking requests before running the solver.

### Accessing the Dashboard

1. Navigate to a session
2. Click the "Review" tab
3. The dashboard shows all requests needing review

### Dashboard Features

#### 1. Confidence Filtering
- **High Confidence (80-100%)**: Exact name matches
- **Medium Confidence (60-79%)**: Partial matches with last initials
- **Low Confidence (0-59%)**: Ambiguous or no matches

Use the preset buttons or slider to filter by confidence level.

#### 2. Request Type Filtering
- Check/uncheck boxes to show specific request types
- "Bunk With" and "Not Bunk With" checkboxes
- All types shown by default

#### 3. Bulk Actions
- **Approve All Visible**: Marks all currently filtered requests as resolved
- **Reject All Visible**: Marks requests as not found (invalid names)
- **Lock Priorities**: Prevents automatic priority adjustments

#### 4. Individual Request Actions
- **Approve**: Validates the name match is correct
- **Reject**: Marks as invalid/not found
- **Lock**: Prevents priority changes during sync

### Understanding Parse Notes

Parse notes provide context about how each request was interpreted:

- **Confidence indicators**: "High confidence: exact match found"
- **Priority keywords**: "Contains keyword: must be with (+10 priority)"
- **Age preferences**: "Age preference: younger from CSV"
- **Prior year**: "Prior year continuity detected: 'same as last year'"

## Conflict Resolution

Some requests create conflicts that require manual resolution:

### Types of Conflicts

1. **Impossible Pairings**
   - A wants to bunk with B
   - B does NOT want to bunk with A
   - Requires family discussion

2. **Circular Conflicts**
   - A wants B, B wants C, C wants A
   - But A and C have negative requests
   - Needs strategic resolution

3. **Group Size Conflicts**
   - Friend group exceeds cabin capacity (12)
   - Must be split into smaller groups
   - System provides split recommendations

### Resolution Process

1. **Review conflicts** in the dashboard
2. **Contact families** if needed
3. **Make decisions** based on:
   - Camper well-being
   - Group dynamics
   - Historical patterns
4. **Document resolution** for future reference

## Prior Year Continuity

The system automatically detects and prioritizes requests to maintain bunking arrangements from previous years.

### How It Works

1. **Detection**: Phrases like "last year", "keep together"
2. **Lookup**: Finds eligible returners from same bunk
3. **Options**:
   - Specific campers: "Jake and Emma from last year"
   - Any returners: "Anyone from our bunk"
4. **Priority**: High (90 for specific, 70 for any)

### Managing Continuity Requests

- Review eligible returners in the dashboard
- Select specific campers or approve "any"
- System ensures at least one returner is included
- Can override if circumstances have changed

## AI Configuration

The request processing system uses advanced AI capabilities for parsing and understanding natural language requests. The AI system is configuration-driven and supports multiple providers.

### Supported AI Providers
- **OpenAI**: GPT-4, GPT-4 Turbo, GPT-4.1-nano (current default)
- **Anthropic**: Claude 3 Opus, Claude 3 Sonnet
- **Ollama**: Self-hosted models (DeepSeek, Llama 3, Mixtral)

**Currently using GPT-4.1-nano**: 91% cost reduction with structured outputs ($0.10/$0.40 per million tokens vs $1.10/$4.40)

### Configuration
AI settings are managed in `config/ai_config.json` and `.credentials`:

```bash
# .credentials
AI_PROVIDER=openai          # Options: openai, mock
AI_API_KEY=your_key_here    # API key for OpenAI
AI_MODEL=gpt-4.1-nano       # Model name
```

**Note**: AI is mandatory - there is no fallback to traditional fuzzy matching.

### AI Components
- **`bunking/ai_providers/`** - Provider abstraction layer supporting multiple AI services
- **`bunking/ai_request_processor.py`** - AI integration for parsing requests (provider-agnostic)
- **`bunking/confidence_scorer.py`** - Multi-signal confidence calculation
- **`scripts/sync/sync_bunk_requests.py`** - Enhanced with AI parsing (AI-only, no fallback)
- **`config/ai_config.json`** - Comprehensive AI configuration including priorities and provider settings

### Comprehensive Field Parsing
The AI parses ALL CSV fields to extract bunk requests:
- **Share Bunk With**: Parent-provided positive requests
- **Do Not Share Bunk With**: Parent-provided negative requests
- **BunkingNotes Notes**: Staff notes containing counselor recommendations
- **Internal Bunk Notes**: Additional staff observations
- **RetParent-Socializewithbest**: Structured age preference field

### Confidence Scoring
The system uses multi-signal confidence scoring:
- **Name matching accuracy** (exact vs fuzzy)
- **Context quality** (session enrollment, grade match)
- **Source reliability** (counselor vs parent)
- **Historical data** (prior year attendance)

### Confidence Levels
- **AUTO_ACCEPT** (≥0.95): No review needed, very high confidence
- **VALID_CHECK** (≥0.90): Spot check only, high confidence
- **VALID** (≥0.85): Accepted but flagged for occasional review
- **MANUAL_REVIEW** (≥0.70): Requires human decision
- **REJECT** (<0.70): Too low confidence, needs manual entry

### Source Deduplication
When the same request appears in multiple fields:
- Counselor recommendations override parent requests for negative requests
- Staff notes take precedence for social/maturity assessments
- Higher confidence sources are preferred
- All sources are tracked for audit trail

### Monitoring AI Performance
The sync script reports AI statistics:
- AI parsed requests: Number of requests processed by AI
- AI high confidence: Requests with ≥90% confidence
- AI manual review needed: Requests requiring human review
- AI parsing failures: Requests where AI failed (uses fallback)

### Request Validation
- AI responses are validated against allowed request types
- Invalid types (e.g., informational notes) are filtered out
- Spread constraints automatically convert to manual review items

## Unresolved Name Handling

The system has special handling for requests where the target camper cannot be found in the database.

### How Unresolved Names Work

1. **Detection**: When a name cannot be matched to any current or historical camper
2. **Negative ID Generation**: The system generates a unique negative ID using a hash of the name
3. **Display**: Shows as "Name (unresolved)" in the review dashboard
4. **Deduplication**: Each unique unresolved name gets its own ID, allowing multiple unresolved requests per camper

### Technical Details

- **Storage**: Unresolved requests are stored with negative `requested_person_cm_id` values
- **Name Preservation**: The original name is stored in the `original_text` field as JSON
- **Frontend Display**: The UI extracts and displays the name from the JSON structure
- **Multiple Requests**: A camper can have multiple "not bunk with" requests for different unresolved names

### Example
If Mia requests not to bunk with "Blooma", "Chloe", and "Zoe", but none of these names can be resolved:
- Blooma gets ID: -374282282
- Chloe gets ID: -438188448  
- Zoe gets ID: -368513042

This ensures all three requests are preserved and displayed properly.

### Resolution Options

1. **Manual Matching**: Use the dropdown to select the correct camper
2. **Leave Unresolved**: Keep as-is if the camper isn't attending
3. **Delete Request**: Remove if entered in error

## Best Practices

### 1. Review Early and Often
- Start reviewing requests as soon as CSV is imported
- Don't wait until solver day
- Address low-confidence matches first

### 2. Communicate with Families
- Reach out for clarification on ambiguous requests
- Discuss conflicts before they become issues
- Document special circumstances

### 3. Use Priority Locking Wisely
- Lock priorities for special circumstances
- Document why a priority was locked
- Review locked priorities each season

### 4. Handle Conflicts Proactively
- Address impossible pairings immediately
- Consider group dynamics in decisions
- Keep detailed notes for future reference

### 5. Validate Friend Groups
- Review auto-detected friend groups
- Adjust completeness thresholds as needed
- Consider manual overrides for special cases

### 6. Monitor No-Request Campers
- Look for red-ringed campers (no requests)
- Consider adding socialize_with_best preferences
- Ensure every camper has at least one connection

## Troubleshooting

### Common Issues

1. **Name Not Found**
   - Check for spelling variations
   - Look for nicknames vs. legal names
   - Consider hyphenated last names

2. **Conflicting Requests**
   - Review both sides of the conflict
   - Check if requests are current year
   - Consider historical context

3. **Low Confidence Matches**
   - Compare against attendee list
   - Check multiple sessions
   - Look for siblings with same last name

### Getting Help

If you encounter issues:
1. Check the parse notes for details
2. Review the confidence score breakdown
3. Consult the troubleshooting guide
4. Contact system administrators

---

*Remember: The goal is to create positive bunking experiences while respecting camper preferences and maintaining appropriate group dynamics.*