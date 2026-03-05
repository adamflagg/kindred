# Drop `occurrence_count` and Fix Source Count Accuracy — Design

## Problem

Three related bugs in how normalized_mappings data is counted and filtered:

### Bug 1: `occurrence_count` is always 0

The `occurrence_count` field on `normalized_mappings` is never populated by the Go sync. The geo management backend (`geo_service.py`) reads this field to compute camper counts in gaps, canonical search, and sources endpoints — producing 0 for all counts.

### Bug 2: `get_sources` doesn't aggregate by `original_value`

With the person+session schema, multiple rows can share the same `original_value` (e.g., 5 campers all typed "riverside elem"). The `get_sources` endpoint produces one `SourceItem` per row instead of grouping, creating duplicate entries with count 0.

### Bug 3: Source counts don't filter by session type

The GeoAnalysis page shows two data streams:

| Data | Source | Filters by session type | Counts |
|------|--------|------------------------|--------|
| Main count (e.g., "San Francisco: 259") | Registration API → `enrolled_person_ids` | Yes (via `session_types` param) | Unique persons |
| Source counts (e.g., "san fran: 456") | `useNormalizedMappings` → `normalized_mappings` | No (only filters by specific `session.cm_id`) | Person-session rows |

When "at camp" is selected, `selectedSessionCmId` is `null` (no specific session), so `useNormalizedMappings` fetches ALL normalized_mappings across ALL session types. Sources also count person-session rows instead of unique persons, so they over-count.

**Observed**: "San Francisco" shows 259 at camp, but expanding sources shows 1+1+2+11+13+456 = 484. "All summer" shows 272 with the same 484 in sources.

## Design

### 1. Drop `occurrence_count` column

- PocketBase migration removes the field (already created: `1500000066_drop_occurrence_count.js`)
- Remove from TypeScript types, test fixtures, and comments

### 2. Fix `geo_service.py` — count rows instead of summing field

Three call sites in `geo_service.py`:

- **`get_gaps` (line 201)**: `+= m.occurrence_count` → `+= 1`
- **`search_canonicals` (line 275)**: `+= m.occurrence_count` → `+= 1`
- **`get_sources` (lines 355-366)**: Replace list comprehension with group-by-`original_value` aggregation, counting rows per group and taking min confidence

### 3. Fix `useNormalizedMappings` — add session type filtering

Add `sessionTypes?: readonly string[]` parameter. When provided (and no specific `session.cm_id`), filter normalized_mappings by session type via session relation:

```
session.session_type ~ "camp" || session.session_type ~ "quest"
```

Update GeoAnalysis.tsx to pass `activeSessionTypes` to the hook.

This ensures source counts reflect the same session scope as the main registration counts.

### 4. Unique person counts in sources (future consideration)

Sources will still count person-session rows (a camper in 4 camp sessions = 4 rows). Making sources count unique persons would require grouping by `person` in addition to `original_value`. This is a separate concern — the session type filter is the higher-priority fix because it causes the most visible discrepancy (484 vs 259). The person-session vs unique-person difference is smaller and arguably informative (shows actual mapping volume).

## Files Changed

| File | Change |
|------|--------|
| `pocketbase/pb_migrations/1500000066_drop_occurrence_count.js` | Already created |
| `api/services/geo_service.py` | Count rows instead of summing field; aggregate `get_sources` by `original_value` |
| `tests/unit/api/test_geo_service.py` | Remove `occurrence_count` from fixtures; update expected counts |
| `frontend/src/types/pocketbase-types.ts` | Remove `occurrence_count` field |
| `frontend/src/hooks/useNormalizedMappings.ts` | Add `sessionTypes` param; remove occurrence_count comments |
| `frontend/src/hooks/useNormalizedMappings.test.ts` | Update assertions referencing occurrence_count |
| `frontend/src/pages/metrics/registration/GeoAnalysis.tsx` | Pass `activeSessionTypes` to `useNormalizedMappings` |
| `tests/unit/api/test_metrics_normalized_geo.py` | Update comments |
