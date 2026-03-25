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
  ↓ Placeholder expansion: 1 placeholder → N individual requests
Expanded (ParseResult, [ResolutionResult])
  ↓ Phase 3: disambiguates remaining ambiguous cases
Final (ParsedRequest, resolution_info)
  ↓ Request Builder: determines status, priority, confidence
BunkRequest → saved to PocketBase bunk_requests table
```

**Critical fan-out:** A single parent who writes "bunk with Emma, Liam, and last year's bunkmates" in the `bunk_with` field could generate 5+ individual `bunk_request` records after name resolution and placeholder expansion.

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
    │       ├─ Context building (row data + staff metadata)
    │       ├─ Batch AI processing (rate-limited, with retries)
    │       └─ Returns list[ParseResult], each containing:
    │           ├─ parsed_requests: list[ParsedRequest] — one per extracted name
    │           │   Each: target_name, request_type, confidence, age_preference,
    │           │          csv_position, metadata (including AI reasoning)
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
    │       ├─ Reject unit/cabin names (nitzanim, galil, eilat, haifa, etc.)
    │       ├─ Accept valid placeholders (sibling, last_year_bunkmates, older, younger)
    │       └─ Accept age preferences (no target name needed)
    │
    ├── 6. INITIALIZE CACHES
    │   ├─ temporal_name_cache.initialize() — O(1) person name lookups
    │   └─ social_graph.initialize() (if smart resolution enabled in config)
    │
    ├── 7. PHASE 2: LOCAL NAME RESOLUTION
    │   └─ See "Phase 2 Detail" section below
    │
    ├── 8. PLACEHOLDER EXPANSION
    │   ├─ LAST_YEAR_BUNKMATES:
    │   │   ├─ Look up prior year bunkmates for requester
    │   │   ├─ Create individual BUNK_WITH request per bunkmate
    │   │   └─ Each at confidence 0.90, method="prior_year_bunkmate"
    │   └─ SIBLING:
    │       ├─ Look up siblings via household_id
    │       ├─ Create request per sibling (preserves original request type)
    │       └─ Each at confidence 0.95, method="sibling_household_lookup"
    │
    ├── 9. POST-EXPANSION CONFLICT FILTER
    │   └─ Catch conflicts from expansion (same target, opposite types)
    │
    ├── 10. PHASE 2.5: HISTORICAL GROUP VERIFICATION
    │   └─ Verify multiple targets were actually in same bunk in prior year
    │   └─ Confidence boost +0.10 (capped at 0.95) if verified
    │
    ├── 11. PHASE 3: AI DISAMBIGUATION (unresolved cases only)
    │   └─ See "Phase 3 Detail" section below
    │
    ├── 12. CONFLICT DETECTION & RESOLUTION
    │   ├─ Generate unresolved person IDs (deterministic negative MD5 hash)
    │   ├─ Detect conflicts (bunk_with vs not_bunk_with for same pair)
    │   └─ Apply resolution (remove losing side)
    │
    ├── 13. CREATE BUNK REQUESTS
    │   ├─ request_builder.build_requests()
    │   │   ├─ Priority calculation (1-4 scale)
    │   │   └─ Status determination:
    │   │       ├─ No person_cm_id → PENDING
    │   │       ├─ Negative cm_id (unresolved hash) → PENDING
    │   │       ├─ Confidence ≥ auto_resolve_threshold → RESOLVED
    │   │       ├─ Confidence < threshold → PENDING
    │   │       └─ Has conflict → DECLINED
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
2. **Jaro-Winkler first name similarity** (Charlie→Charlotte, Zoey→Zoe): confidence ~0.85. Threshold configurable via PB config `jaro_winkler_threshold` (default 0.85). Also checks `preferred_name`.
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
| `name_score` | `match_certainty` from `resolution_result.confidence > 0.9` | "exact"=1.0, "partial"=0.7, "ambiguous"=0.4, "none"=0.0 |
| `ai_score` | Phase 1 AI parse confidence | Typically 0.85 |
| `context_score` | Attendee enrollment lookup | found_in_current_year=0.8, previous_year_only=0.4, base=0.5. Social bonuses: in_ego_network +0.1, social_distance≤2 +0.1 |
| `reciprocal_score` | Reciprocal pair detection | Hardcoded 0.0 in formula (not implemented). Reciprocal boost (+0.1) applied separately by `reciprocal_detector.py` after request building. |

**NOT_BUNK_WITH formula:**
```
score = 0.75 × name_score + 0.20 × ai_score + 0.05 × context_score
```

**AGE_PREFERENCE:** Returns `ai_parse_confidence` directly (typically 1.0 for dropdown, 0.85 for AI-parsed).

**Worked examples:**
```
Same-session exact match (correct):  0.70 × 1.0 + 0.15 × 0.85 + 0.10 × 0.8 = 0.9075 → RESOLVED
Diff-session exact match:            0.70 × 0.7 + 0.15 × 0.85 + 0.10 × 0.8 = 0.6975 → PENDING
With reciprocal boost (+0.1):        0.6975 + 0.10 = 0.7975 → still PENDING (below 0.85)
```

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

**Production data (2026, 1014 source records → 1908 output requests):**

`bunk_with` dominates at 90% of source records. AI-parsed age preferences from `bunk_with` (63) outnumber the `socialize_with` dropdown (13) by 5:1. `bunk_with` also produces NOT_BUNK_WITH requests (4) when parents express negative preferences in the free text. `bunking_notes` generates both BUNK_WITH (30) and NOT_BUNK_WITH (32) from staff notes. The `not_bunk_with` field has only 1 source record — parents overwhelmingly express negative requests within `bunk_with` text rather than using the separate field.

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

Data from 864-trace production run (2026 season, 1014 source records → 1908 output requests).

### Stages with production impact

| Stage | Fires | Useful | Notes |
|---|---|---|---|
| No-preference detection | 50× | 50× | All in `bunk_with`. Correctly skips "n/a", "none", etc. |
| NA prefix stripping | 7× | 7× | All in `bunk_with`. Preserves age preferences after "N/A;" prefix. |
| Phase 1 text dedup | ~24× | ~24× | Saves ~24 AI calls (mostly sibling pairs). 50 of 66 "duplicates" are no-pref values skipped before AI. |
| Type validation | All | Safety net | Enforces not_bunk_with → NOT_BUNK_WITH. Critical safety check. |
| Reciprocal detection | 560× (280 pairs) | 560× | 29% of requests are reciprocal. Boost effective once base confidence is correct. |

### Stages with low/zero production impact

| Stage | Fires | Useful | Notes |
|---|---|---|---|
| Temporal conflict filter | 1500× | **0×** | Zero `is_superseded` or `temporal_date` in 2026 data. Only relevant for notes fields. |
| Source text validation (unit names) | All | **0 rejections** | Unit names appear as person last names ("Chen-Carmel") but resolve correctly. Risk of false positive for camper named "Eilat". |
| Phase 2.5 historical verification | 832× | **0×** | `historical_year` was never set in 2026 data. PR #780 wires AI extraction of `historical_year` → Phase 2.5 — re-measure after next production run. |
| Placeholder expansion | All | **0 triggers** | 395 `prior_year_bunkmate` requests came from Phase 2's prior bunkmate shortcut, not placeholder expansion. |
| Self-reference detection | All | **0 hits** | Free safety net, no production matches. |
| Staff name detection | All rows | **1 hit** | Low value but cheap. Only reads notes fields. |

### Phase 3 AI Disambiguation

643 requests sent to Phase 3, only 51 resolved (**8% success rate**). 569 came back still pending. Low ROI — improving Phase 2 resolution (nickname matching, prefix matching) would be cheaper and more effective.

### Unresolved Names (358 "unknown" method)

68 names exist in the `persons` table but the resolution pipeline failed to match them. Known gaps:

- **Nickname-to-full-name prefix matching**: "Liv Garcia" → Olivia Garcia exists but `preferred_name` is "Olivia" not "Liv". No prefix matching strategy.
- **Parenthetical nicknames**: "Liam (Nickname)" — nickname in parentheses not stripped before matching.
- **Single-letter spelling variations**: "Emma Kniffen" vs "Emma Kniffin" — close enough for fuzzy but not caught.
- **Input normalization**: " Noah Johnson" (leading whitespace), "EMMA CHEN" (all-caps).
- **AI misparses from notes**: "AG-identified campers", "ALL-GENDER CABIN" — staff shorthand parsed as person names.

323 names don't match any person — misspellings, not-yet-enrolled, or non-camper references.

---

## Architectural Improvement Opportunities

Identified from production data analysis (2026-03-18). Pending implementation.

1. **Split socialize_with** out of the main pipeline. Fork early (after direct parse), merge before dedup. socialize_with currently rides through 10+ stages as a no-op passenger.
2. **Lazy + concurrent cache init.** Temporal name cache and social graph initialize unconditionally. Guard on whether any AI-parsed results need name resolution. Run both concurrently (`asyncio.gather`).
3. ~~**Remove Phase 2.5**~~ — Addressed by PR #780: `historical_year` now extracted by AI parse and wired through to Phase 2.5 verification.
4. **Scope temporal conflict filter** to notes fields only (zero hits on other fields).
5. **Scope NA stripping** to `bunk_with` only (zero hits on other fields).
6. **Guard staff detection** on `source_fields` filter (no-op when processing non-notes fields).
7. **Conditional post-expansion conflict filter** (only when expansion happened — 0 triggers in production).
8. **Fix Phase 3 string contract.** Phase 3 exclusion uses `rr.method != "age_preference"` (fragile string). Use `RequestType.AGE_PREFERENCE` enum.
9. ~~**Improve Phase 2 resolution**~~ — Partially addressed by PR #780: jellyfish Jaro-Winkler matching catches close name variants (Zoey/Zoe, Kiefer/Kieffer), `nicknames` library provides broader nickname coverage (Rob→Robert), and preferred_name matching in exact strategy. Remaining gap: prefix matching (Liv→Olivia) not yet implemented.
10. **Expand conflict detection** with attendee enrollment data for auto-decline (cross-session BUNK_WITH) and auto-approve (cross-session NOT_BUNK_WITH).
11. **Method-aware auto-resolve thresholds.** Exact match at 0.82 is more trustworthy than phonetic at 0.87.
12. **SIBLING expansion enrollment check.** Current sibling lookup doesn't verify enrollment in the same session.
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
  │                      ├─ Phase 1: AI Parse (with text dedup)
  │                      ├─ Type validation
  │                      ├─ [if notes fields]: Temporal conflict filter
  │                      ├─ Source text validation
  │                      │
  │                      ├─ [lazy, concurrent]: Cache init (temporal + social graph)
  │                      ├─ Phase 2: Local resolution
  │                      ├─ [if placeholders found]: Expansion + post-expansion conflict
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
| `bunk_request_processor/services/placeholder_expander.py` | Expand LAST_YEAR_BUNKMATES and SIBLING placeholders |
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
| **P2 Resolution** | `phase2_resolution[]` | Per intent: target name, fast paths tried + results, all candidates with score breakdowns (session match, grade proximity, social signal, spread filter), pipeline strategies tried in order with confidence/candidate counts, final result (person CM ID, name, confidence, method, resolved/ambiguous flags, confidence factors), staff filtered flag, hallucination detected, social graph details (enhanced, connection strength, shared friends, smart resolved, reranked), spread filter applied |
| **Expansion** | `placeholder_expansion` | Triggered flag, expansion type (last_year_bunkmates/sibling), expanded count, expanded targets list with names and request types |
| **P2.5 Historical** | `historical_verification` | Whether verification ran, boost applied flag, original confidence, boosted confidence (boost is +0.10, capped at 0.95) |
| **P3 Disambiguation** | `phase3_disambiguation[]` | Per intent: target name, ran flag, candidates sent (top 5 with details), AI context, AI selection (person CM ID), AI reasoning + chain-of-thought, result status (not_needed/resolved/no_match/still_ambiguous), confidence before/after |
| **Post-Pipeline** | `post_pipeline` | Conflict detection (has_conflict + details), self-reference detected, reciprocal (detected, boost applied, boost amount, pair CM ID), deduplication (was_duplicate, kept_over), final bunk requests list (requester/target CM IDs, names, request type, status, confidence, priority, resolution method, is_placeholder, declined reason) |

### Debug Tool UI

The Pipeline Debug page (`/summer/debug/pipeline`) provides:
- **Batch overview**: Select a trace-enabled run → see summary table with PB-native filtering (status, confidence, resolution method, session, source field, Phase 3 triggered)
- **Drill-down**: Click a row → React Flow canvas with 8 phase nodes. Click any node → detail panel showing all captured data for that phase
- **New Trace**: Pick a specific camper → run their requests through the pipeline (optionally stop at any phase) → see results immediately
- **Re-execution**: "Run Again" (single phase, dry-run) or "Run From Here →" (cascade through remaining phases)
