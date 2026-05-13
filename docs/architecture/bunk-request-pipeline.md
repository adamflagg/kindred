# Bunk Request Pipeline: CSV to Solver-Ready Requests

Complete reference for how CSV files become `bunk_requests` records the solver can use.

## Overview

```
CSV File (CampMinder export)
    │
    ▼
┌─────────────────────────────────┐
│  STAGE 1: Frontend Upload       │  React → Go API
│  (BunkRequestsUpload component) │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│  STAGE 2: Go CSV Sync           │  Go → PocketBase
│  (bunk_requests.go)             │
│  Creates original_bunk_requests │
│  with MD5 delta detection       │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│  STAGE 3: Python Orchestrator   │  Go HTTP → FastAPI → Python
│  (RequestOrchestrator)          │
│  3-phase pipeline:              │
│    Phase 1: AI Parse            │
│    Phase 2: Name Resolution     │
│    Phase 3: AI Disambiguation   │
│  Creates bunk_requests          │
└─────────────────────────────────┘
```

## Data Transformations at a Glance

```
CSV Row (1 row per camper)
  ↓ Go: 1 row → up to 5 original_bunk_requests (one per field)
original_bunk_requests
  ↓ Python Loader: groups by person, uses field names as dict keys
Raw request dict (one per person, all fields merged)
  ↓ _prepare_parse_requests: splits into individual ParseRequests
ParseRequest (one per field per person)
  ↓ Phase 1 AI: extracts multiple names from free text
ParseResult → [ParsedRequest, ParsedRequest, ...] (multiple targets per field)
  ↓ Phase 2: resolves each name to a person
(ParseResult, [ResolutionResult, ...])
  ↓ Phase 3: disambiguates remaining ambiguous cases
Final (ParsedRequest, resolution_info)
  ↓ Request Builder: determines status, priority, confidence
BunkRequest → saved to PocketBase bunk_requests table
```

**Named individuals only:** Every `bunk_request` must name a specific camper. Unnamed group references ("last year's bunkmates", "kids from her school") and categorical exclusions ("loud kids") produce a single PENDING staff-review record with `ambiguity_reason="no_named_individual"` and the original phrase preserved in `parse_notes`.

---

## Stage 1: Frontend Upload

**Files:** `frontend/src/components/BunkRequestsUpload.tsx` → `frontend/src/services/sync.ts`

1. User selects CSV file in the `BunkRequestsUpload` component
2. `uploadBunkRequestsCSV(file, fetchWithAuth, year?)` sends multipart POST to:
   ```
   /api/custom/sync/upload-bunk-requests?run_sync=true&run_process_requests=true&year=2025
   ```
3. Query params control chaining:
   - `run_sync=true` triggers Go CSV sync after upload
   - `run_process_requests=true` chains Python processing after sync completes
   - `year` overrides the default year from `CAMPMINDER_SEASON_ID`

---

## Stage 2: Go CSV Sync

**Files:** `pocketbase/sync/api.go` (upload handler) → `pocketbase/sync/bunk_requests.go` (sync logic)

### 2a. Upload Handler

**Function:** `handleBunkRequestsUpload` (`api.go:714-826`)

```
Multipart POST received
    │
    ├─ readCSVFromMultipart()
    │   ├─ Read file part (50MB limit)
    │   ├─ Strip UTF-8 BOM if present
    │   └─ Return raw CSV bytes
    │
    ├─ parseAndValidateCSV()
    │   ├─ LazyQuotes=true, TrimLeadingSpace=true, FieldsPerRecord=-1
    │   └─ Return trimmed headers
    │
    ├─ findMissingColumns() — case-insensitive check for:
    │   ├─ "PersonID" (required)
    │   ├─ "Last Name" (required)
    │   └─ "First Name" (required)
    │
    ├─ determineUploadYear()
    │   ├─ Default: from CAMPMINDER_SEASON_ID env var
    │   └─ Override: ?year= query param (2017-2050 range)
    │
    ├─ saveCSVWithBackup()
    │   ├─ Save to pb_data/bunk_requests/{year}_latest.csv
    │   └─ Backup existing file as {year}_backup_{timestamp}.csv
    │
    ├─ Write upload_metadata.json (filename, timestamp, size, header count)
    │
    └─ IF run_sync=true:
        └─ goroutine:
            ├─ orchestrator.runSyncAndWait(ctx, "bunk_requests")
            └─ IF run_process_requests=true AND sync succeeded:
                └─ NewRequestProcessor(app).Sync(ctx) → calls Python API
```

### 2b. CSV Column Mapping

**5 CSV columns → 5 internal fields** (`bunk_requests.go:25-32`):

| CSV Column Header | Internal Field | AI Required? |
|---|---|---|
| `Share Bunk With` | `bunk_with` | Yes |
| `Do Not Share Bunk With` | `not_bunk_with` | Yes |
| `Internal Bunk Notes` | `internal_notes` | Yes |
| `BunkingNotes Notes` | `bunking_notes` | Yes |
| `RetParent-Socializewithbest` | `socialize_with` | No (dropdown) |

### 2c. Per-Row Processing and Delta Detection

**Function:** `processRow` (`bunk_requests.go:187-284`)

```
For each CSV row:
    │
    ├─ Extract PersonID (parse as int, skip if invalid)
    │
    ├─ Check enrollment: is person in validPersonIDs map?
    │   └─ NO → skip silently (not enrolled this year)
    │
    └─ For EACH of the 5 fields:
        │
        ├─ Get field content from CSV column
        │
        ├─ IF content is empty:
        │   └─ DELETE existing original_bunk_requests record (if any)
        │
        └─ IF content exists:
            ├─ Calculate MD5 hash: md5(content) → hex string
            │
            ├─ Query existing record: person + year + field combo
            │
            ├─ IF existing record found:
            │   ├─ Compare content_hash values
            │   ├─ SAME hash → SKIP (no change detected)
            │   └─ DIFFERENT hash → UPDATE record:
            │       ├─ Set new content + content_hash
            │       └─ CLEAR processed timestamp → triggers reprocessing
            │
            └─ IF no existing record:
                └─ CREATE new record:
                    ├─ requester: PocketBase person ID (relation)
                    ├─ year: upload year
                    ├─ field: "bunk_with" | "not_bunk_with" | etc.
                    ├─ content: raw CSV text
                    ├─ content_hash: MD5 hex
                    └─ processed: "" (empty — awaiting processing)
```

### 2d. original_bunk_requests Record Schema

| Field | Type | Purpose |
|---|---|---|
| `requester` | relation (persons) | PocketBase person ID |
| `year` | int | Camp year |
| `field` | select | One of: bunk_with, not_bunk_with, bunking_notes, internal_notes, socialize_with |
| `content` | text | Raw text extracted from CSV cell |
| `content_hash` | text | MD5 hex digest for delta detection |
| `processed` | datetime | Empty = needs processing; timestamp = already processed |

---

## Stage 3: Python Orchestrator

### Entry Path

```
Go process_requests.go
    → HTTP POST /api/internal/process-requests
        → FastAPI run_process_requests()
            → process_bunk_requests()
                → RequestOrchestrator.process_requests()
```

**Go wrapper** (`process_requests.go`): Calls Python with 35-minute timeout. Passes year, session, source_fields, limit, force, clear_existing, debug, trace.

### 3a. Loading from Database

**File:** `bunking/sync/bunk_request_processor/process_requests.py` → `integration/original_requests_loader.py`

```
OriginalRequestsLoader(pb, year, session_cm_ids)
    │
    ├─ load_persons_cache()
    │   ├─ Query attendees for current year AND year-1
    │   ├─ Filter by valid bunking sessions
    │   └─ Build two caches:
    │       ├─ _person_sessions[cm_id] → [session_cm_ids] (current year)
    │       └─ _person_previous_year_sessions[cm_id] → [session_cm_ids]
    │
    ├─ IF force=true:
    │   └─ clear_processed_flags() — reset processed="" on matching records
    │
    ├─ count_already_processed() — visibility metric for stats
    │
    ├─ fetch_requests_needing_processing()
    │   ├─ Filter: year={year} AND field IN {fields} AND processed=""
    │   ├─ Session filtering:
    │   │   ├─ ≤50 valid persons → add requester.cm_id filter to PB query
    │   │   └─ >50 valid persons → fetch all, filter in Python
    │   ├─ Expand: requester (person details: cm_id, name, grade)
    │   └─ Sort: -updated (most recent first)
    │
    └─ convert_to_orchestrator_input()
        ├─ Group requests by requester_cm_id
        ├─ For each person:
        │   ├─ Resolve session (first matching target session)
        │   ├─ Build row dict with person info
        │   ├─ Use V2 field names as dict keys (bunk_with, not_bunk_with, etc.)
        │   │   No mapping needed — field names are used directly
        │   └─ Track _original_request_ids[field] = pb_record_id
        └─ Return list[dict] — one per person, multiple fields per row
```

### 3b. Orchestrator Main Flow

**File:** `orchestrator/orchestrator.py` — `process_requests()` (lines 939-1161)

```
process_requests(raw_requests, clear_existing, progress_callback)
    │
    ├── 1. STAFF NAME DETECTION
    │   └─ Extract notes from bunking_notes + internal_notes
    │   └─ Build global staff/parent name set for filtering during resolution
    │
    ├── 2. CLEAR EXISTING (if clear_existing=true)
    │   └─ Granular per-field per-person clearing
    │   └─ Only clears source_fields being reprocessed, preserves others
    │
    ├── 3. PREPARE PARSE REQUESTS (_prepare_parse_requests)
    │   │  For each raw_request row, for each of 5 fields:
    │   │
    │   ├─ Empty text → SKIP
    │   ├─ is_no_preference(text)? → SKIP
    │   │   Matches: "no bunk requests", "no preference", "none", "n/a", "na"
    │   ├─ strip_na_prefix(text)?
    │   │   "N/A; but likes kids their grade" → "but likes kids their grade"
    │   ├─ bunking_notes special handling:
    │   │   └─ parse_multi_staff_notes() extracts:
    │   │       ├─ Staff attribution: "FIRST LAST (datetime)"
    │   │       ├─ Cleaned content (staff signatures removed)
    │   │       └─ staff_metadata {name, timestamp}
    │   ├─ Session validation: skip if person not enrolled or not in target sessions
    │   ├─ SPECIAL: socialize_with field → NO AI needed
    │   │   └─ _parse_socialize_preference() maps dropdown values directly:
    │   │       ├─ "Kids their own grade and one grade above" → OLDER
    │   │       └─ "Kids their own grade and one grade below" → YOUNGER
    │   │   └─ Added to pre_parsed_results (bypasses Phase 1)
    │   └─ ALL OTHER FIELDS → Create ParseRequest for AI parsing
    │
    │   Returns: (parse_requests, pre_parsed_results)
    │
    ├── 4. PHASE 1: AI PARSE
    │   └─ phase1_service.batch_parse(parse_requests)
    │       ├─ Input sanitization (detect injection attempts, confidence penalties)
    │       ├─ Context building (row data + staff metadata + school/congregation/city)
    │       ├─ Batch AI processing (transient error retry + exponential backoff)
    │       │   ├─ Batch-level: up to 5 retries per batch for transient errors
    │       │   ├─ Item-level: individual failures tagged, batch continues
    │       │   └─ Phase-level: up to 3 retry rounds (30s/60s/60s delays)
    │       │       with reconciliation logging (transient vs permanent)
    │       └─ Returns list[ParseResult], each containing:
    │           ├─ parsed_requests: list[ParsedRequest] — one per extracted name
    │           │   Each: target_name, request_type, confidence, age_preference,
    │           │          csv_position, needs_clarification, ambiguity_reason,
    │           │          metadata (including AI reasoning)
    │           ├─ needs_historical_context: bool
    │           └─ metadata
    │   Combine with pre_parsed_results (socialize_with)
    │
    ├── 5. POST-PARSE VALIDATION CHAIN
    │   ├─ _validate_request_types()
    │   │   └─ Enforce field→type rules (not_bunk_with must be NOT_BUNK_WITH, etc.)
    │   ├─ _filter_temporal_conflicts()
    │   │   ├─ Pass 1: Remove is_superseded=true requests
    │   │   └─ Pass 2: Group by target, resolve bunk_with vs not_bunk_with
    │   │       conflicts by temporal_date or csv_position (higher = newer)
    │   └─ _validate_target_names_in_source()
    │       ├─ Reject hallucinated names not found in source text
    │       ├─ Reject unit/cabin names
    │       ├─ Accept age preferences (no target name needed)
    │       └─ Accept staff-review fallback records (empty target_name + needs_clarification=true)
    │
    ├── 6. INITIALIZE CACHES
    │   ├─ temporal_name_cache.initialize() — O(1) person name lookups
    │   └─ social_graph.initialize() (if smart resolution enabled in config)
    │
    ├── 7. PHASE 2: LOCAL NAME RESOLUTION
    │   └─ See "Phase 2 Detail" section below
    │
    ├── 8. PHASE 2.5: HISTORICAL GROUP VERIFICATION
    │   └─ Verify multiple named targets were actually in same bunk in prior year
    │   └─ Confidence boost +0.10 (capped at 0.95) if verified
    │
    ├── 9. PHASE 3: AI DISAMBIGUATION (unresolved cases only)
    │   └─ See "Phase 3 Detail" section below
    │
    ├── 10. CONFLICT DETECTION & RESOLUTION
    │   ├─ Generate unresolved person IDs (deterministic negative MD5 hash)
    │   ├─ ConflictDetector (enriched with AttendeeRepository for full session visibility)
    │   │   ├─ Build session map from requester data + bulk attendee lookup for unknown targets
    │   │   ├─ TARGET_NOT_ENROLLED: target has no bunking enrollment → DECLINED (checked first)
    │   │   ├─ BUNK_WITH cross-session → SESSION_MISMATCH → DECLINED
    │   │   ├─ NOT_BUNK_WITH cross-session → CROSS_SESSION_SATISFIED → auto-RESOLVED
    │   │   ├─ AG silo: AG sessions are distinct session IDs, so regular↔AG requests
    │   │   │   are caught by cross-session detection (no special AG logic needed)
    │   │   └─ Session metadata (requester_session, target_session) captured for bunk staff review
    │   └─ Apply resolution (remove losing side)
    │
    ├── 11. CREATE BUNK REQUESTS
    │   ├─ request_builder.build_requests()
    │   │   ├─ Priority calculation (1-4 scale)
    │   │   └─ Status determination:
    │   │       ├─ No person_cm_id → PENDING
    │   │       ├─ Negative cm_id (unresolved hash) → PENDING
    │   │       ├─ Confidence ≥ auto_resolve_threshold → RESOLVED
    │   │       ├─ Confidence < threshold → PENDING
    │   │       ├─ Has conflict (SESSION_MISMATCH) → DECLINED
    │   │       ├─ Target not enrolled (TARGET_NOT_ENROLLED) → DECLINED
    │   │       └─ auto_satisfied (cross-session NOT_BUNK_WITH) → RESOLVED
    │   ├─ _apply_validation_pipeline()
    │   │   ├─ Self-Reference: Detect A→A requests, flag for staff review
    │   │   ├─ Deduplication: Remove duplicates, keep highest priority
    │   │   └─ Reciprocal Detection: A→B + B→A gets confidence boost (+0.10)
    │   └─ _save_bunk_requests() → PocketBase bunk_requests table
    │
    └── 14. MARK ORIGINALS AS PROCESSED
        └─ Set processed=UTC_timestamp on all source original_bunk_requests
        └─ Prevents reprocessing on next run
```

---

## Phase 2 Detail: Name Resolution

**File:** `services/phase2_resolution_service.py` + `resolution/resolution_pipeline.py`

For each `ParsedRequest` that has a `target_name` to resolve:

### Pre-Pipeline Fast Paths

Tried in order before the resolution pipeline. First match wins.

```
A. STAFF NAME FILTER
   └─ IF target is in detected staff/parent name set:
       └─ confidence=0.0, method="staff_filtered", SKIP resolution

B. PRIOR BUNKMATE RESOLUTION (if "last year" keywords detected)
   └─ Look up prior year bunkmates → match by name
       ├─ Exact match: confidence=0.95, method="prior_bunkmate_exact"
       └─ First name only: confidence=0.90, method="prior_bunkmate_first_name"

C. AI ID VALIDATION (if AI provided a target_cm_id)
   ├─ Validate person exists in DB
   ├─ Validate name matches (exact/normalized/nickname/partial)
   ├─ IF complete mismatch: detect hallucination, fall through to pipeline
   └─ IF match: confidence=0.75-0.95, method="ai_id_validated"

D. AI CANDIDATE RESOLUTION (if AI provided candidate list)
   └─ Score each candidate: session match (+0.3) + grade proximity (+0.2)
   └─ Best score > 0.5 → resolved at min(0.75, score)
```

### Resolution Pipeline (Cascade)

If no fast path resolved the name, try strategies in order. First confident match wins.

#### Strategy 1: Exact Match (`resolution/strategies/exact_match.py`)

- First+Last name DB lookup (case-insensitive)
- Parent surname fallback: "Emma Smith" matches "Emma Johnson" if parent is Smith
- Session validation:

| Scenario | Confidence |
|---|---|
| Single match, same session | **0.95** |
| Single match, different session | **0.85** |
| Single match, no session info | **0.90** |
| Multiple matches, unique in session | **0.95** |
| Multiple matches, still ambiguous | **0.50** |
| All matches in different sessions | **0.0** (impossible) |

**Session matching uses `bulk_get_sessions_for_persons()`** which queries attendee enrollments and returns `session_cm_id` values. This must filter to bunking-relevant session types only (`main`, `embedded`, `ag`) to avoid family camp / quest enrollments corrupting the session comparison. See `VALID_BUNKING_SESSION_TYPES` in `session_repository.py`.

#### Strategy 2: Fuzzy Match (`resolution/strategies/fuzzy_match.py`)

Five-step cascade:

1. **Nickname variations** (Bob→Robert, Kate→Katherine): confidence ~0.85. Sources: built-in groups, camp overrides (`config/nicknames_override.json`), `nicknames` PyPI library.
2. **Jaro-Winkler first name similarity** (Charlie→Charlotte, Zoey→Zoe): confidence ~0.85. Threshold configurable via PB config `jaro_winkler_threshold` (default 0.85). Also checks `preferred_name`. Falls back to full `all_persons` pool when candidates are empty, catching last-name misspellings (Obsfeld→Obstfeld). Full-pool matches tagged `match_type: "jaro_winkler_full_pool"`.
3. **Spelling variations** (Alexis↔Alexus, Stephine↔Stephanie): confidence ~0.85
4. **Normalized search** (substring matching in full/preferred names): confidence ~0.80
5. **Parent surname match**: confidence ~0.70

Session adjustments: same session +0.0, different session -0.10, not enrolled -0.05.

#### Strategy 3: Phonetic Match (`resolution/strategies/phonetic_match.py`)

Three algorithms:

1. **Soundex** (consonant→digit mapping): confidence ~0.70
2. **Metaphone** (language-aware phonetics): confidence ~0.65
3. **Nickname groups** (bidirectional group membership): confidence ~0.75

Session adjustments: same session +0.05, different session -0.20, not enrolled -0.05.

#### Strategy 4: School Disambiguation (`resolution/strategies/school_disambiguation.py`)

Used when multiple same-named candidates remain ambiguous:

- School name normalization (abbreviation mapping: "elementary school"→"es", etc.)
- Location verification (city + state match)
- Grade proximity scoring:

| Match Quality | Confidence |
|---|---|
| Same school + same grade + same session | **0.90** |
| Same school + same grade | **0.85** |
| Same school + adjacent grade (±1) | **0.70** |
| Same school only | **0.75** |

### Post-Pipeline: Single Name Candidates

**File:** `resolution/resolution_pipeline.py` (`_generate_single_name_candidates`)

First-name-only targets (no last name) that went unresolved after the pipeline get session-filtered candidate lists via `find_by_first_name`, capped at 5 candidates, at confidence 0.3 with method `single_name_candidates`. These are passed to Phase 3 for AI disambiguation. 35 hits in the March 25 production run.

### Post-Pipeline: Social Graph Enhancement

For cases still ambiguous after the pipeline, if NetworkX analyzer is configured:

- Analyze social connections between requester and candidates
- Smart resolve if connection strength margin ≥ 0.1 between candidates
- Otherwise rank candidates by social score (top 5 passed to Phase 3)

### Confidence Scoring

**File:** `confidence/confidence_scorer.py`

After Phase 2 resolution, the confidence scorer re-scores each resolved result using a weighted formula. The resolution pipeline's raw confidence (0.95, 0.85, etc.) is replaced by the scorer's output.

**BUNK_WITH formula:**
```
score = 0.70 × name_score + 0.15 × ai_score + 0.10 × context_score + 0.05 × reciprocal_score
```

| Signal | Source | Values |
|---|---|---|
| `name_score` | `match_certainty` from `resolution_result.confidence > 0.9` | "exact"=1.0, "partial"=0.7, "ambiguous"=0.4, "none"=0.0. **Known bug:** uses `> 0.9` (strictly greater), so resolution confidence of exactly 0.90 (no-session-info exact match, parent surname match) classifies as "partial" instead of "exact". See "Known Issues". |
| `ai_score` | Phase 1 AI parse confidence | Typically 0.85 |
| `context_score` | Attendee enrollment lookup | found_in_current_year=0.8, previous_year_only=0.4, base=0.5. Social bonuses: in_ego_network +0.1, social_distance≤2 +0.1 |
| `reciprocal_score` | Reciprocal pair detection | Hardcoded 0.0 in formula (not implemented). Reciprocal boost (+0.1) applied separately by `reciprocal_detector.py` after request building. |

**NOT_BUNK_WITH formula:**
```
score = 0.75 × name_score + 0.20 × ai_score + 0.05 × context_score
```

**AGE_PREFERENCE:** Two resolution paths with different confidence levels:

| Source | Direction | Confidence | Method |
|---|---|---|---|
| `socialize_with` dropdown | Directional (OLDER or YOUNGER) | **1.0** | Pre-parsed, exact dropdown match |
| AI-parsed from `bunk_with` | Directional (OLDER or YOUNGER) | **0.90** | `age_preference` — AI extracted direction from reasoning |
| AI-parsed, no direction | Undirected (None) | **0.50** | `age_preference_undirected` — staff review needed |

Directional mapping: AI extracts OLDER/YOUNGER from reasoning (e.g., "wants to be with older kids"). When the AI recognizes an age preference but cannot determine direction, `age_preference` is None and the request goes to staff review at 0.50 confidence.

**Worked examples:**
```
Same-session exact match (correct):  0.70 × 1.0 + 0.15 × 0.85 + 0.10 × 0.8 = 0.9075 → RESOLVED
No-session-info exact match (bug):   0.70 × 0.7 + 0.15 × 0.85 + 0.10 × 0.8 = 0.6975 → PENDING (should be 0.9075)
  (resolution returns 0.90, but 0.90 is NOT > 0.9, so name_score = 0.7 "partial" instead of 1.0 "exact")
With reciprocal boost:               0.6975 + 0.10 = 0.7975 → still PENDING (threshold is 0.85)
Cross-session BUNK_WITH:             Score irrelevant — ConflictDetector auto-DECLINES
Cross-session NOT_BUNK_WITH:         Score irrelevant — ConflictDetector auto-RESOLVES (satisfied)
```

**Score breakdown in traces (`confidence_factors`):**

After each scoring call, `ConfidenceScorer.last_score_factors` contains the full breakdown. The Phase 2 service captures these factors immediately into `resolution_result.metadata["confidence_factors"]` (to avoid stale reads in batch loops). The orchestrator then reads them into both the Phase 2 trace (`Phase2FinalResult.confidence_factors`) and the request builder (`resolution_info["confidence_factors"]`):

```json
{
  "formula": "bunk_with",
  "name_score": 1.0,
  "ai_score": 0.85,
  "context_score": 0.8,
  "reciprocal_score": 0.0,
  "weights": {"name_match": 0.70, "ai_parsing": 0.15, "context": 0.10, "reciprocal_bonus": 0.05},
  "weighted_total": 0.9075
}
```

---

## Group References: Staff-Review Only

**Removed in PR #891.** The pipeline previously auto-expanded unnamed group references (siblings, last-year bunkmates, classmates, congregation) into individual bunk requests via `PlaceholderExpander` and a resolver registry. Production data showed ~61 garbage expansions per 1 useful result, so the feature was deleted.

Current behavior:

- Every `bunk_request` must name a specific camper.
- Unnamed group references ("last year's bunkmates", "kids from her school", "her twin" with no name given) and categorical exclusions ("loud kids") are parsed into a single PENDING `bunk_request` with:
  - `target_name = ""`
  - `needs_clarification = true`
  - `ambiguity_reason = "no_named_individual"`
  - `parse_notes` = original phrase verbatim
- Staff reviews each PENDING record and decides manually.

See the six parse prompt templates under `config/prompts/parse_*.txt` for the AI-facing guidance. `HistoricalVerificationService` and `find_prior_year_bunkmates()` are retained for named-individual lookups like "Mike from last year" where the AI has a concrete name to resolve.

---

## Phase 3 Detail: AI Disambiguation

**File:** `services/phase3_disambiguation_service.py`

Only invoked for ambiguous results that have candidates but couldn't be uniquely resolved.

```
For each ambiguous resolution:
    │
    ├─ Build context:
    │   ├─ target_name, top-5 candidates (from Phase 2 / social ranking)
    │   ├─ Requester info, session, year
    │   ├─ Field context: "Requested together with: [other names from same field]"
    │   └─ Social signals if available
    │
    ├─ Batch AI disambiguation call
    │
    └─ Results:
        ├─ AI selects specific person_cm_id:
        │   ├─ Validate selection is in top-5 candidates
        │   ├─ Apply confidence scorer
        │   └─ confidence ~0.80, method="ai_disambiguation"
        │
        ├─ AI says no_match:
        │   └─ Stays unresolved
        │
        └─ AI unclear:
            └─ Stays ambiguous (PENDING for manual review)
```

---

## Delta Handling

The system has **two layers of delta detection**:

| Layer | Mechanism | Where | What Triggers Reprocessing |
|---|---|---|---|
| **Go → original_bunk_requests** | MD5 content hash | `bunk_requests.go:processRow()` | Content actually changed (hash differs). Clears `processed` flag. |
| **Python → bunk_requests** | `processed=""` flag | `original_requests_loader.py` | `processed` field is empty (never processed, or cleared by Go after change). |

**Force reprocessing:** Pass `force=true` to clear `processed` flags → Python re-fetches and reprocesses everything.

**Normal flow:**
1. Go computes MD5 of new CSV content
2. Compares to stored `content_hash` on existing record
3. Same hash → skip (no work). Different hash → update content, clear `processed`
4. Python only fetches records where `processed=""` — only changed/new records
5. After processing, Python sets `processed` to current UTC timestamp

---

## Field Classification

| Field | Source | AI Parse? | Parse Method | Output Type |
|---|---|---|---|---|
| `bunk_with` | Parent form | Yes | AI extracts person names | BUNK_WITH requests |
| `not_bunk_with` | Parent form | Yes | AI extracts person names | NOT_BUNK_WITH requests |
| `bunking_notes` | Staff notes | Yes | AI extracts names + context | BUNK_WITH or NOT_BUNK_WITH |
| `internal_notes` | Staff notes | Yes | AI extracts names + context | BUNK_WITH or NOT_BUNK_WITH |
| `socialize_with` | Parent dropdown | No | Direct mapping | AGE_PREFERENCE (OLDER/YOUNGER) |

**Production data (2026, v3.11 March 26 — 1226 source OBRs → 1630 output requests):**

`bunk_with` dominates at 78% of source OBRs (958/1226). AI-parsed age preferences from `bunk_with` outnumber the `socialize_with` dropdown by ~5:1. `bunk_with` also produces NOT_BUNK_WITH requests when parents express negative preferences in free text. `bunking_notes` generates both BUNK_WITH and NOT_BUNK_WITH from staff notes. The `not_bunk_with` field has only 2 source records — parents overwhelmingly express negative requests within `bunk_with` text rather than using the separate field.

**Note:** The v3.11 output count (1630) is lower than expected (~1830) due to OpenAI transient failures (30+ server 500 errors, 2 read timeouts) that silently dropped ~145 OBRs. See "Known Issues" section.

---

## Deduplication Cross-Field Behavior

**File:** `processing/deduplicator.py`

The deduplicator removes duplicate `BunkRequest` objects within a batch using a key-based grouping system. The key varies by request type to enable cross-field deduplication where appropriate.

| Request Type | Dedup Key | Cross-Field? | Rationale |
|---|---|---|---|
| AGE_PREFERENCE | `(requester, None, AGE_PREFERENCE, "", year, session)` | Yes — empty source_field | Same age preference from any source is one intent |
| BUNK_WITH / NOT_BUNK_WITH | `(requester, target, type, "", year, session)` | Yes — empty source_field | Same requester→target pair from bunk_with and bunking_notes merges to one request |
| Placeholders | `key = None` | N/A | Bypass dedup entirely |

When duplicates share a key, the primary is chosen by `SOURCE_PRIORITY` (STAFF=2 > FAMILY=1) then confidence (descending). `_merge_metadata()` records all contributing sources in a `merged_sources` array for frontend display.

**AGE_PREFERENCE cross-field dedup:** If `bunk_with` produces AGE_PREFERENCE OLDER (AI-parsed from "I want older kids") and `socialize_with` also produces AGE_PREFERENCE OLDER (dropdown), both hit the AGE_PREFERENCE branch first (type check precedes source_field check), get the same key, and deduplicate correctly.

---

## Session Types and Multi-Enrollment

**File:** `data/repositories/session_repository.py`

Campers may be enrolled in multiple sessions simultaneously (e.g., Session 2 + Family Camp + B'Mitzvah Program). Only bunking-relevant sessions matter for name resolution session matching.

```python
VALID_BUNKING_SESSION_TYPES = {"main", "embedded", "ag"}
```

| Type | Sessions (2026) | Examples |
|---|---|---|
| `main` | 4 | Session 2, Session 3, Session 4, Taste of Camp 1 |
| `embedded` | 3 | Session 2a, Session 3a, Taste of Camp 2 |
| `ag` | 3 | All-Gender Cabin sessions |

Non-bunking types (35 sessions): `family`, `quest`, `bmitzvah`, `hebrew`, `teen`, `tli`, `training`, `adult`, `school`, `other`.

**Multi-enrollment stats (2026):** 1643 campers in 1 session, 291 in 2, 63 in 3, 8 in 4.

`bulk_get_sessions_for_persons()` in `AttendeeRepository` must use `get_full_list` (not `get_list`) to handle multi-enrolled campers, and filter results to `VALID_BUNKING_SESSION_TYPES` so that family camp enrollments don't corrupt session matching.

---

## Per-Stage Production Effectiveness

### Run History

| Run | Version | Date | Source OBRs | Output BRs | Resolved | Pending | Declined | Notes |
|---|---|---|---|---|---|---|---|---|
| March 18 | v3.7.1 | 2026-03-18 | 1014 | 1908 | 293 (15.4%) | 1364 (71.5%) | 251 (13.2%) | Session matching bug caused mass misclassification |
| March 25 | v3.9 | 2026-03-25 | ~1014 | ~1576 | 1157 (73.5%) | 354 (22.5%) | 65 (4.1%) | Session bug fixed, cross-session detection added |
| March 26 | v3.11 | 2026-03-26 | 1226 | 1630 | 1109 (68.0%) | 408 (25.0%) | 113 (6.9%) | Newer CSV, ~145 OBRs lost to OpenAI failures. Phase 3 broken by code bug. |

**v3.11 note:** The lower resolved percentage vs March 25 is misleading — the newer CSV has more registrations (1226 vs ~1014 OBRs), and ~145 OBRs with real content were never processed due to OpenAI 500/timeout errors. The actual auto-resolve rate for successfully-processed requests is comparable.

### v3.11 Resolution Method Distribution

| Method | Count | Resolved | Pending | Declined | Avg Conf |
|---|---|---|---|---|---|
| exact_match | 1021 | 891 | 39 | 91 | 0.931 |
| *(age_preference, no method)* | 213 | 198 | 15 | 0 | 0.879 |
| fuzzy_match | 161 | 1 | 143 | 17 | 0.721 |
| unknown (unresolved) | 159 | 0 | 159 | 0 | 0.000 |
| single_name_candidates | 37 | 0 | 37 | 0 | 0.300 |
| prior_bunkmate_exact | 13 | 13 | 0 | 0 | 0.958 |
| phonetic_match | 13 | 0 | 11 | 2 | 0.724 |
| prior_bunkmate_first_name | 5 | 5 | 0 | 0 | 0.960 |
| school_disambiguation | 4 | 0 | 1 | 3 | 0.698 |

(Note: `placeholder_expansion_failed`, `sibling_household_lookup`, and `prior_year_bunkmate` rows from v3.11 are omitted — the group-expansion feature that produced them was removed in PR #891.)

### v3.11 Confidence Value Clusters (exact_match)

| Confidence | Status | Count | Explanation |
|---|---|---|---|
| 1.0000 | resolved | 538 | Same-session exact match (0.9075) + reciprocal boost (+0.1), capped at 1.0 |
| 0.9075 | resolved | 277 | Same-session exact match, no reciprocal pair |
| 0.9275 | resolved | 59 | Same-session + social signal bonuses |
| 0.6975 | declined | 90 | Cross-session — declined by ConflictDetector. Low confidence due to `> 0.9` bug but irrelevant since declined. |
| 0.6975 | pending | 30 | No-session-info exact matches stuck by `> 0.9` threshold bug |
| 0.7975 | pending | 8 | Same as above + reciprocal boost (+0.1), still below 0.85 threshold |

### Stages with production impact (v3.11)

| Stage | Fires | Useful | Notes |
|---|---|---|---|
| No-preference detection | ~50× | ~50× | All in `bunk_with`. Correctly skips "n/a", "none", etc. |
| NA prefix stripping | ~7× | ~7× | All in `bunk_with`. Preserves age preferences after "N/A;" prefix. **Gap:** 3 ambiguous entries like "None. Preference for own grade/older" are currently caught by no-preference detection, dropping the trailing age preference. |
| Phase 1 text dedup | ~24× | ~24× | Saves ~24 AI calls (mostly sibling pairs). |
| Type validation | All | Safety net | Enforces not_bunk_with → NOT_BUNK_WITH. 46 invalid requests rejected (group refs with empty target_name). |
| Reciprocal detection | 620× (310 pairs) | 543 resolved | 38% of requests are reciprocal. 543/620 boosted past threshold. 77 still pending (base 0.6975 from `> 0.9` bug). |
| Unit name validation | All | **2 rejections** | Nitzanim and Carmel correctly caught. Previously reported as 0 — now working. |
| Hallucination detection | All | **2 rejections** | Safety net working. |

### Stages with low/zero production impact (v3.11)

| Stage | Fires | Useful | Notes |
|---|---|---|---|
| Temporal conflict filter | All | **0×** | Zero `is_superseded` or `temporal_date` in 2026 data. Only relevant for notes fields. |
| Phase 2.5 historical verification | All resolved | **6 failures, 0 boosts** | `historical_year=0` in bunk_request metadata despite 6 verification attempts logged. AI may be setting it inconsistently. |
| Self-reference detection | All | **0 hits** | Free safety net, no production matches. |
| Staff name detection | All rows | **1 hit + false positives** | Detected "Maya" as staff. Also matched sentence fragments: 'Also add', 'Director', 'Eve to', 'I just', 'This was'. Heuristic needs tightening. |

### Phase 3 AI Disambiguation (v3.11)

**0% success — completely broken.** All 14 disambiguation cases failed with `'dict' object has no attribute 'request_text'` — a dataclass/dict mismatch bug in the batch processor's disambiguation path. This is a code bug, not an AI quality issue. See "Known Issues".

Prior run (March 25, v3.9): 513 sent to Phase 3, 207 resolved (40.3% success rate).

### Unresolved Names (159 "unknown" + 37 "single_name_candidates" in v3.11)

159 names don't match any person — misspellings, not-yet-enrolled, or non-camper references. 37 first-name-only targets generated candidate lists at confidence 0.3 for Phase 3 (which then failed due to the dict bug).

Known resolution gaps (unchanged from prior analysis):

- **Nickname-to-full-name prefix matching**: "Liv Garcia" → Olivia Garcia exists but `preferred_name` is "Olivia" not "Liv". No prefix matching strategy.
- **Parenthetical nicknames**: "Liam (Nickname)" — nickname in parentheses not stripped before matching.
- **Single-letter spelling variations**: "Emma Kniffen" vs "Emma Kniffin" — close enough for fuzzy but not always caught.
- **Input normalization**: " Noah Johnson" (leading whitespace), "EMMA CHEN" (all-caps).
- **AI misparses from notes**: "AG-identified campers" — staff shorthand parsed as person names.
- **NOT_BUNK_WITH misparses**: categorical exclusions (demographic or trait references) parsed as person target names from bunking_notes. These are category references, not individuals. Addressed by PR #891: now emitted as a single PENDING staff-review record with `ambiguity_reason="no_named_individual"` rather than an invented target name.
- **Parent surname index empty**: 0 unique surnames loaded in v3.11 run. The parent surname fallback path in ExactMatchStrategy is effectively dead code. Likely a cache initialization bug.

---

## Architectural Improvement Opportunities

Identified from production data analysis (2026-03-18). Pending implementation.

1. **Split socialize_with** out of the main pipeline. Fork early (after direct parse), merge before dedup. socialize_with currently rides through 10+ stages as a no-op passenger.
2. **Lazy + concurrent cache init.** Temporal name cache and social graph initialize unconditionally. Guard on whether any AI-parsed results need name resolution. Run both concurrently (`asyncio.gather`).
3. ~~**Remove Phase 2.5**~~ — Addressed by PR #780: `historical_year` now extracted by AI parse and wired through to Phase 2.5 verification.
4. **Scope temporal conflict filter** to notes fields only (zero hits on other fields).
5. **Scope NA stripping** to `bunk_with` only (zero hits on other fields).
6. **Guard staff detection** on `source_fields` filter (no-op when processing non-notes fields).
7. ~~**Conditional post-expansion conflict filter**~~ — Superseded: group-expansion feature removed entirely in PR #891.
8. **Fix Phase 3 string contract.** Phase 3 exclusion uses `rr.method != "age_preference"` (fragile string). Use `RequestType.AGE_PREFERENCE` enum.
9. ~~**Improve Phase 2 resolution**~~ — Partially addressed by PR #780: jellyfish Jaro-Winkler matching catches close name variants (Zoey/Zoe, Kiefer/Kieffer), `nicknames` library provides broader nickname coverage (Rob→Robert), and preferred_name matching in exact strategy. Remaining gap: prefix matching (Liv→Olivia) not yet implemented.
10. ~~**Expand conflict detection**~~ — Addressed: ConflictDetector now receives AttendeeRepository for full session visibility. BUNK_WITH cross-session → auto-DECLINED, NOT_BUNK_WITH cross-session → auto-RESOLVED.
11. ~~**Method-aware auto-resolve thresholds**~~ — Superseded by cross-session auto-decline. The 0.6975 PENDING cases are now correctly DECLINED (BUNK_WITH) or RESOLVED (NOT_BUNK_WITH) based on session enrollment data.
13. **Extract shared strategy methods to BaseMatchStrategy.** `_apply_session_adjustment_simple()`, `_calculate_confidence()`, and `_disambiguate_with_session()` are duplicated across `FuzzyMatchStrategy` and `PhoneticMatchStrategy`. Extract to base class to reduce ~160 lines of duplication.
14. **Fix N+1 spread filter query in resolution pipeline.** `resolution_pipeline.py` batch-loads all persons at line 212, but re-queries `person_repo.find_by_cm_id(requester_cm_id)` inside the per-request loop at line 284 when spread filter is enabled. Should reuse the pre-loaded dict.

### Proposed Conditional Gating Architecture

One pipeline with conditional stages + late merge for socialize_with:

```
Input: original_bunk_requests rows
  │
  ├─ [if notes fields in scope]: Staff name detection (build global set)
  │
  ├─ Fork by parse type:
  │   ├─ socialize_with ──→ direct parse ──→ HOLD
  │   └─ AI fields ──→ Prepare parse requests (NA strip, no-pref)
  │                      │
  │                      ├─ Phase 1: AI Parse (with text dedup, retry rounds)
  │                      ├─ Type validation
  │                      ├─ [if notes fields]: Temporal conflict filter
  │                      ├─ Source text validation
  │                      │
  │                      ├─ [lazy, concurrent]: Cache init (temporal + social graph)
  │                      ├─ Phase 2: Local resolution
  │                      ├─ [if unresolved]: Phase 3 AI disambiguation
  │                      │
  │                      ├─ Conflict detection (BUNK_WITH/NOT_BUNK_WITH only)
  │                      └─ Request builder
  │
  ├─ MERGE POINT ◄── socialize_with results + AI-resolved results
  │
  ├─ Self-reference validation
  ├─ Deduplication (cross-field — catches AGE_PREFERENCE overlap here)
  ├─ Reciprocal detection
  │
  ├─ Save to bunk_requests
  └─ Mark original_bunk_requests processed
```

---

## Key Constants and Thresholds

**Source:** `shared/constants.py`, `core/constants.py`, PocketBase `config` table

| Constant | Default | Purpose |
|---|---|---|
| Auto-resolve threshold | 0.85 | Confidence ≥ this → RESOLVED status |
| Reciprocal boost | +0.10 | Added when A→B and B→A both exist |
| Historical verification boost | +0.10 | Added when prior-year bunk verified (capped 0.95) |
| Exact match same-session | 0.95 | Highest local resolution confidence |
| Fuzzy nickname base | 0.85 | Nickname variation match |
| Phonetic soundex base | 0.70 | Soundex phonetic match |
| Unresolved ID range | -1B to -1M | Deterministic negative IDs from MD5 hash |

---

## Key Files Reference

### Go (Stage 2)
| File | Purpose |
|---|---|
| `pocketbase/sync/api.go` | Upload handler, CSV validation, save with backup |
| `pocketbase/sync/bunk_requests.go` | CSV→original_bunk_requests sync with MD5 delta |
| `pocketbase/sync/process_requests.go` | Thin Go wrapper calling Python API |

### Python (Stage 3)

#### Entry & Loading
| File | Purpose |
|---|---|
| `api/routers/internal.py` | FastAPI endpoint `/api/internal/process-requests` |
| `bunk_request_processor/process_requests.py` | Main entry: load config, load data, run orchestrator |
| `bunk_request_processor/integration/original_requests_loader.py` | Load from original_bunk_requests, delta filtering, mark processed |

#### Orchestrator & Phases
| File | Purpose |
|---|---|
| `bunk_request_processor/orchestrator/orchestrator.py` | Main pipeline: 3 phases + validation + conflict detection |
| `bunk_request_processor/services/phase1_parse_service.py` | AI parsing: text → ParsedRequests |
| `bunk_request_processor/services/phase2_resolution_service.py` | Name resolution: ParsedRequest → ResolutionResult |
| `bunk_request_processor/services/phase3_disambiguation_service.py` | AI disambiguation for ambiguous cases |

#### Resolution Strategies
| File | Purpose |
|---|---|
| `bunk_request_processor/resolution/resolution_pipeline.py` | Cascade orchestrator for strategies |
| `bunk_request_processor/resolution/strategies/exact_match.py` | First+Last name DB lookup |
| `bunk_request_processor/resolution/strategies/fuzzy_match.py` | Nickname, spelling, normalized, parent surname |
| `bunk_request_processor/resolution/strategies/phonetic_match.py` | Soundex, Metaphone, nickname groups |
| `bunk_request_processor/resolution/strategies/school_disambiguation.py` | School+grade+location disambiguation |

#### Supporting Services
| File | Purpose |
|---|---|
| `bunk_request_processor/services/placeholder_expander.py` | Expand group references via resolver registry (sibling, bunkmate, classmate, congregation) |
| `bunk_request_processor/services/group_resolvers.py` | GroupResolver protocol, 4 resolver implementations, registry builder |
| `bunk_request_processor/services/staff_note_parser.py` | Extract staff attribution from bunking_notes |
| `bunk_request_processor/services/request_builder.py` | Build final BunkRequest with status/priority/metadata |
| `bunk_request_processor/services/request_deduplication.py` | Remove duplicate requests |
| `bunk_request_processor/services/staff_name_detector.py` | Detect staff/parent names to exclude |
| `bunk_request_processor/processing/reciprocal_detector.py` | Detect A→B + B→A pairs for confidence boost |
| `bunk_request_processor/processing/deduplicator.py` | Cross-field bunk request deduplication |
| `bunk_request_processor/confidence/confidence_scorer.py` | Weighted confidence scoring with social signals |
| `bunk_request_processor/conflict/conflict_detector.py` | Detect and resolve conflicting requests |
| `bunk_request_processor/data/repositories/session_repository.py` | Session type classification, `VALID_BUNKING_SESSION_TYPES` |

#### Data & Models
| File | Purpose |
|---|---|
| `bunk_request_processor/core/models.py` | ParseRequest, ParsedRequest, ParseResult, BunkRequest, Person |
| `bunk_request_processor/shared/constants.py` | SourceField enum (V2 names), processing fields, patterns, thresholds |
| `bunk_request_processor/core/constants.py` | AI confidence thresholds |
| `bunk_request_processor/integration/ai_service.py` | AI provider abstraction |
| `bunk_request_processor/integration/batch_processor.py` | Batch AI calls with rate limiting |

### Frontend (Stage 1)
| File | Purpose |
|---|---|
| `frontend/src/components/BunkRequestsUpload.tsx` | Upload UI component |
| `frontend/src/services/sync.ts` | `uploadBunkRequestsCSV()` API call |

---

## Pipeline Debug Trace Reference

The pipeline debug tool captures trace data at every phase when `collect_traces=true` is set on the process-requests API, or when using the Pipeline Debug page's "New Trace" flow. Traces are stored in the `debug_pipeline_traces` PocketBase collection as JSON.

**Schema source:** `bunking/sync/bunk_request_processor/debug/trace_models.py`
**TypeScript types:** `frontend/src/components/pipeline-debug/types.ts`

### What Each Phase Captures

| Phase | Key | What's Captured |
|---|---|---|
| **Pre-P1** | `pre_phase1` | Action taken (parsed/skipped/direct_mapped), skip reason, original vs cleaned text, staff metadata, requester info (name, CM ID, grade), session IDs, socialize mapped value, field path, N/A prefix stripped |
| **P1 Parse** | `phase1_parse` | Per intent: target name, request type, confidence, keywords, AI reasoning + chain-of-thought, parse notes, needs_clarification, temporal info. Plus: ran flag, token count, processing time, sanitization (suspicious detection, risk level, confidence penalty), raw AI response, is_valid, error message |
| **Validation** | `validation` | Type validation (passed flag + rejected list), temporal conflicts (filtered count + details), source text validation (rejected count, hallucinated names, unit/cabin names) |
| **P2 Resolution** | `phase2_resolution[]` | Per intent: target name, fast paths tried + results, all candidates with score breakdowns (session match, grade proximity, social signal, spread filter), pipeline strategies tried in order with confidence/candidate counts, final result (person CM ID, name, confidence, method, resolved/ambiguous flags, **confidence_factors** from scorer — formula, component scores, weights, weighted total), staff filtered flag, hallucination detected, social graph details (enhanced, connection strength, shared friends, smart resolved, reranked), spread filter applied |
| **P2.5 Historical** | `historical_verification` | Whether verification ran, boost applied flag, original confidence, boosted confidence (boost is +0.10, capped at 0.95) |
| **P3 Disambiguation** | `phase3_disambiguation[]` | Per intent: target name, ran flag, candidates sent (top 5 with details), AI context, AI selection (person CM ID), AI reasoning + chain-of-thought, result status (not_needed/resolved/no_match/still_ambiguous), confidence before/after |
| **Post-Pipeline** | `post_pipeline` | Conflict detection (has_conflict + serialized V2Conflict details with type, severity, auto_resolvable), self-reference detected, reciprocal (detected, boost applied, boost amount, pair CM ID), deduplication (was_duplicate, kept_over), final bunk requests list (requester/target CM IDs, names, request type, status [RESOLVED/PENDING/DECLINED/DEDUPED], confidence, priority, resolution method, is_placeholder, declined reason). Deduped-out requests are marked status=DEDUPED in traces rather than showing stale pre-dedup status. |

### Debug Tool UI

The Pipeline Debug page (`/summer/debug/pipeline`) provides:
- **Batch overview**: Select a trace-enabled run → see summary table with PB-native filtering (status, confidence, resolution method, session, source field, Phase 3 triggered)
- **Drill-down**: Click a row → React Flow canvas with 7 phase nodes. Click any node → detail panel showing all captured data for that phase
- **New Trace**: Pick a specific camper → run their requests through the pipeline (optionally stop at any phase) → see results immediately
- **Re-execution**: "Run Again" (single phase, dry-run) or "Run From Here →" (cascade through remaining phases)

---

## Known Issues (as of v3.11, 2026-03-26)

### P0: Critical

**PB Go-side timeout shorter than API processing time.** The Go sync caller (`process_requests.go`) uses a 35-minute timeout. The v3.11 full-force run took ~2.3 hours. PocketBase logs `context deadline exceeded` and thinks the run failed, but the FastAPI API continues processing as an orphan and completes successfully. Data is written but the Go caller doesn't know.

### P1: High

**~~OpenAI transient failures silently drop requests.~~** Fixed in PR #794. `BatchProcessor` now retries all transient errors (timeout, 500, rate limit, connection) with exponential backoff at the batch level (up to 5 retries). `openai_provider.parse_request()` re-raises transient errors for callers to retry. Individual item failures within a batch are tagged and the batch continues. Phase 1 adds up to 3 retry rounds (30s/60s/60s) with reconciliation logging showing transient vs permanent failures.

**Confidence threshold `> 0.9` should be `>= 0.9`.** `confidence_scorer.py:198` uses strictly greater than. ExactMatchStrategy returns 0.90 for no-session-info and parent-surname matches. These get classified as "partial" (name_score=0.7) instead of "exact" (name_score=1.0), producing confidence 0.6975 instead of 0.9075. **39 exact matches stuck pending** in v3.11, plus 8 reciprocal-boosted at 0.7975 (still below 0.85 threshold).

**PocketBase 400 on large IN clause.** Bulk person lookup with ~240 IDs exceeds PocketBase's URL/filter length limit. Need to chunk bulk lookups into smaller batches.

**OBR processed flag doesn't distinguish success vs error.** When AI fails for an OBR (timeout, 500), the OBR is still marked `processed` with a timestamp — indistinguishable from a successful parse. On re-run without `force=true`, these are skipped as "already processed." PR #794 mitigates this by retrying transient failures (so fewer OBRs silently fail), but does not change the processed-flag logic. Need either: a separate `processed_error` state, or don't set `processed` timestamp when AI returns zero results due to transient failure.

### P2: Medium

**AI response logging at INFO.** Every AI response with full request text and parsed output (~800+ lines per run). Single biggest log noise source. Should be DEBUG.

**API key partially logged.** `AI config: provider=openai, model=gpt-5-nano, api_key=sk-svcac...yUsA` at INFO level. Even truncated, should be masked entirely.

**Staff name detection false positives.** Heuristic matches sentence fragments as staff names: 'Also add', 'Director', 'Eve to', 'I just', 'This was'. Needs tighter matching (minimum word count, name-like pattern check).

**NOT_BUNK_WITH AI misparses** (historical, fixed in PR #891). Category references from bunking_notes were being parsed as person names. These are group/category descriptors, not individuals; the current pipeline emits a single PENDING staff-review record with `ambiguity_reason="no_named_individual"` instead.

**N/A entries with trailing age preferences.** No-preference detection catches entries like "None. Preference for own grade/older" and "N/A\nOwn Grade/Younger", dropping the trailing age preference content. These should be parsed for the age preference after stripping the N/A prefix.


**`_estimate_batch_size` uses midpoint average, not actual batch sizes.** When a batch fails, `batch_parse_requests` estimates the failed batch's size as `(MIN_BATCH_SIZE + MAX_BATCH_SIZE) // 2` = 27, but actual batch sizes vary with dynamic sizing. This can silently skip items or double-count them in the failure path. Should track actual batch sizes alongside batch results instead of re-estimating.

**`batch_disambiguate` failure fallback uses wrong size estimate.** Uses `len(disambiguation_requests) // max(1, len(batch_results))` (floor division) to estimate failed batch size. Wrong whenever batches are unequal in size (which is the normal case with dynamic batching). Same root cause as `_estimate_batch_size` — actual sizes aren't preserved.

**Duplicate `_create_failed_result` in two classes.** `BatchProcessor._create_failed_result` and `Phase1ParseService._create_failed_result` are identical — same signature, same `ParseResult` construction, same metadata shape. Should be extracted to a shared utility in `core/models.py` or Phase1 should delegate to `self.batch_processor._create_failed_result()`.

### P3: Low

**32 records escape force-clear.** Force mode cleared 802 processed flags but 32 already-processed records were skipped. These have a different field pattern that escapes the clear filter.

**Reciprocal formula slot dead.** `reciprocal_score = 0.0` hardcoded in `confidence_scorer.py:321` with 0.05 weight. The actual reciprocal boost (+0.1) is applied separately by `reciprocal_detector.apply_reciprocal_boost()`. The formula slot should be removed or unified with the detector.

**Log level audit needed.** Multiple INFO-level messages should be DEBUG: "Processing batch request X/Y", "AI parsed RequestType.AGE_PREFERENCE from bunk_with field", "Created unresolved request for...", "Invalid RequestType.BUNK_WITH request without target name", session graph build stats, cache building details, individual name resolution matches.

**Fuzzy matches near threshold.** 12 fuzzy matches at confidence 0.8175, just below the 0.85 auto-resolve threshold. Method-aware thresholds (e.g., exact_match at 0.82 trusted more than phonetic at 0.87) would rescue these.
