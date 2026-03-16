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
  ↓ Python Loader: groups by person, maps field names
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
        │   ├─ Map field content to orchestrator keys:
        │   │   ├─ bunk_with        → share_bunk_with
        │   │   ├─ not_bunk_with    → do_not_share_bunk_with
        │   │   ├─ bunking_notes    → bunking_notes_notes
        │   │   ├─ internal_notes   → internal_bunk_notes
        │   │   └─ socialize_with   → ret_parent_socialize_with_best
        │   └─ Track _original_request_ids[field] = pb_record_id
        └─ Return list[dict] — one per person, multiple fields per row
```

### 3b. Orchestrator Main Flow

**File:** `orchestrator/orchestrator.py` — `process_requests()` (lines 939-1161)

```
process_requests(raw_requests, clear_existing, progress_callback)
    │
    ├── 1. STAFF NAME DETECTION
    │   └─ Extract notes from bunking_notes + internal_bunk_notes
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

#### Strategy 2: Fuzzy Match (`resolution/strategies/fuzzy_match.py`)

Four-step cascade:

1. **Nickname variations** (Bob→Robert, Kate→Katherine): confidence ~0.85
2. **Spelling variations** (Alexis↔Alexus, Stephine↔Stephanie): confidence ~0.85
3. **Normalized search** (substring matching in full/preferred names): confidence ~0.80
4. **Parent surname match**: confidence ~0.70

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

Weighted scoring by request type:

**BUNK_WITH weights:** name_match=0.70, ai_parsing=0.15, context=0.10, reciprocal=0.05
**NOT_BUNK_WITH weights:** name_match=0.75, ai_parsing=0.20, context=0.05

Context signals include: found_in_current_year, social graph distance, ego network membership, grade/age proximity.

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
| `bunk_request_processor/confidence/confidence_scorer.py` | Weighted confidence scoring with social signals |
| `bunk_request_processor/conflict/conflict_detector.py` | Detect and resolve conflicting requests |

#### Data & Models
| File | Purpose |
|---|---|
| `bunk_request_processor/core/models.py` | ParseRequest, ParsedRequest, ParseResult, BunkRequest, Person |
| `bunk_request_processor/shared/constants.py` | Field mappings, processing fields, patterns, thresholds |
| `bunk_request_processor/core/constants.py` | AI confidence thresholds |
| `bunk_request_processor/integration/ai_service.py` | AI provider abstraction |
| `bunk_request_processor/integration/batch_processor.py` | Batch AI calls with rate limiting |

### Frontend (Stage 1)
| File | Purpose |
|---|---|
| `frontend/src/components/BunkRequestsUpload.tsx` | Upload UI component |
| `frontend/src/services/sync.ts` | `uploadBunkRequestsCSV()` API call |
