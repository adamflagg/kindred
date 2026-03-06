# Drop `occurrence_count` and Fix Source Count Accuracy — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the vestigial `occurrence_count` field, fix all backend counting to use row-counting, fix `get_sources` aggregation, and add session type filtering to `useNormalizedMappings`.

**Architecture:** Three independent fixes: (1) backend counts rows instead of summing a dead field, (2) `get_sources` groups by `original_value` before counting, (3) frontend hook accepts session types for proper filtering. Migration drops the column.

**Tech Stack:** Python/FastAPI, TypeScript/React, PocketBase migration (JS)

---

## Task 1: Fix backend `get_gaps` and `search_canonicals` — count rows

**Files:**
- Modify: `api/services/geo_service.py:201` and `api/services/geo_service.py:275`
- Modify: `tests/unit/api/test_geo_service.py:32-48` (fixture)

**Step 1: Update `_make_mapping_record` fixture — remove `occurrence_count`**

In `tests/unit/api/test_geo_service.py`, change the fixture:

```python
def _make_mapping_record(
    original_value: str,
    normalized_value: str,
    category: str = "school",
    confidence: float = 1.0,
    year: int = 2025,
) -> Mock:
    """Create a mock normalized_mappings record."""
    record = Mock()
    record.original_value = original_value
    record.normalized_value = normalized_value
    record.category = category
    record.confidence = confidence
    record.year = year
    return record
```

**Step 2: Update test mock data — use multiple records instead of `occurrence_count`**

Tests that used `occurrence_count=N` to mean "N campers" now need N separate mock records. Key tests to update:

`test_canonical_no_coords_detected` (line 106-107): Was `occurrence_count=5` and `occurrence_count=10` = 15 total. Now use 5 records of "riverside elem" + 10 records of "Riverside Elementary" = 15. But this is verbose. Instead, since each record = 1 person, create the right number of records and update expected counts:

```python
# Before: 2 records with occurrence_count=5 and occurrence_count=10, expected count=15
# After: 2 records (1 each), expected count=2
mappings = [
    _make_mapping_record("riverside elem", "Riverside Elementary"),
    _make_mapping_record("Riverside Elementary", "Riverside Elementary"),
]
# ... assert count == 2 (not 15)
```

Apply this pattern to ALL tests in `TestGetGaps`:
- `test_canonical_no_coords_detected`: 2 records → count=2
- `test_non_canonical_grouped_detected`: 3 records → count=3
- `test_non_canonical_ungrouped_detected`: 1 record → count=1 (was `occurrence_count=2`)
- `test_gaps_sorted_by_count_descending`: 3 records (1 each) → all count=1, so sort by name. Instead, give Big School 3 records, Medium School 2, Small School 1 to preserve meaningful sort:
  ```python
  mappings = [
      _make_mapping_record("Small School", "Small School"),
      _make_mapping_record("Big School", "Big School"),
      _make_mapping_record("Big School 2", "Big School"),
      _make_mapping_record("Big School 3", "Big School"),
      _make_mapping_record("Medium School", "Medium School"),
      _make_mapping_record("Medium 2", "Medium School"),
  ]
  # Expect: Big School (3), Medium School (2), Small School (1)
  # Note: Big School now has 3 source variants, Medium has 2, so they become non_canonical_grouped
  # Small School has 1 source variant, so it stays non_canonical_ungrouped
  ```
- `test_mixed_gap_categories`: Update counts to match record count (1 each)
- `test_search_filters_by_query`: 3 records (1 each) → counts are 1 each
- `test_search_includes_location_metadata`: 1 record → count=1
- `test_search_source_badge_nces`: 1 record → count=1

**Step 3: Fix `geo_service.py` — count rows**

Line 201:
```python
# Before:
groups[nv]["count"] += m.occurrence_count
# After:
groups[nv]["count"] += 1
```

Line 275:
```python
# Before:
camper_counts[nv] = camper_counts.get(nv, 0) + m.occurrence_count
# After:
camper_counts[nv] = camper_counts.get(nv, 0) + 1
```

**Step 4: Run tests**

```bash
cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/unit/api/test_geo_service.py -v
```

**Step 5: Commit**

```
fix(api): count normalized_mapping rows instead of summing occurrence_count

The occurrence_count field was never populated by the Go sync (always 0).
Count rows directly since each row = 1 person-session.
```

---

## Task 2: Fix `get_sources` aggregation

**Files:**
- Modify: `api/services/geo_service.py:340-375`
- Modify: `tests/unit/api/test_geo_service.py` (TestGetSources class)

**Step 1: Update `test_groups_by_original_value` test**

The test needs to use multiple records per `original_value` to verify aggregation:

```python
async def test_groups_by_original_value(self, service: GeoService, mock_pb: MagicMock) -> None:
    """Should group normalized_mappings by original_value with row counts."""
    mappings = [
        # 3 persons typed "riverside elem"
        _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95),
        _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.93),
        _make_mapping_record("riverside elem", "Riverside Elementary", confidence=0.95),
        # 2 persons typed exact name
        _make_mapping_record("Riverside Elementary", "Riverside Elementary", confidence=1.0),
        _make_mapping_record("Riverside Elementary", "Riverside Elementary", confidence=1.0),
        # 1 person typed long form
        _make_mapping_record("riverside elementary school", "Riverside Elementary", confidence=0.85),
    ]

    with patch("api.services.geo_service._load_static_location") as mock_location:
        mock_location.return_value = {"Riverside Elementary": {"city": "Springfield", "state": "IL"}}
        mock_pb.collection.return_value.get_full_list.return_value = mappings

        result = await service.get_sources("school", "Riverside Elementary", 2025)

    assert result.canonical_name == "Riverside Elementary"
    assert len(result.sources) == 3
    # Sort by count descending
    assert result.sources[0].original_value == "riverside elem"
    assert result.sources[0].count == 3
    assert result.sources[0].confidence == 0.93  # min confidence
    assert result.sources[1].original_value == "Riverside Elementary"
    assert result.sources[1].count == 2
    assert result.sources[2].original_value == "riverside elementary school"
    assert result.sources[2].count == 1
```

Update `test_includes_city_state` to remove `occurrence_count`:
```python
mappings = [
    _make_mapping_record("riverside elem", "Riverside Elementary"),
]
```

**Step 2: Fix `get_sources` in `geo_service.py`**

Replace lines 355-366:

```python
        # Group by original_value, counting rows and tracking min confidence
        source_groups: dict[str, dict[str, Any]] = {}
        for m in mappings:
            ov: str = m.original_value
            if ov not in source_groups:
                source_groups[ov] = {"count": 0, "confidence": m.confidence}
            source_groups[ov]["count"] += 1
            source_groups[ov]["confidence"] = min(source_groups[ov]["confidence"], m.confidence)

        sources: list[SourceItem] = [
            SourceItem(original_value=ov, count=g["count"], confidence=g["confidence"])
            for ov, g in source_groups.items()
        ]
```

Also update the docstring on line 343: remove "occurrence counts".

**Step 3: Run tests**

```bash
cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/unit/api/test_geo_service.py::TestGetSources -v
```

**Step 4: Commit**

```
fix(api): aggregate get_sources by original_value with row counting

Each normalized_mappings row = 1 person-session. Multiple rows can share
the same original_value. Group and count rows per original_value, taking
min confidence across duplicates.
```

---

## Task 3: Add session type filtering to `useNormalizedMappings`

**Files:**
- Modify: `frontend/src/hooks/useNormalizedMappings.ts`
- Modify: `frontend/src/hooks/useNormalizedMappings.test.ts`
- Modify: `frontend/src/pages/metrics/registration/GeoAnalysis.tsx:85-101`

**Step 1: Update `useNormalizedMappings` hook**

Add `sessionTypes` parameter. When `sessionCmId` is undefined but `sessionTypes` is provided, build a PocketBase filter using the session relation's `session_type` field:

```typescript
export function useNormalizedMappings(
  year: number,
  category: NormalizedCategory,
  enabled: boolean,
  sessionCmId?: number,
  sessionTypes?: readonly string[]
) {
  return useQuery({
    queryKey: queryKeys.normalizedMappings(year, category, sessionCmId, sessionTypes),
    queryFn: async () => {
      let filter = `year = ${year} && category = "${category}"`
      if (sessionCmId !== undefined) {
        filter += ` && session.cm_id = ${sessionCmId}`
      } else if (sessionTypes && sessionTypes.length > 0) {
        // Filter by session types when no specific session selected
        const typeFilters = sessionTypes.map((t) => `session.session_type = "${t}"`)
        filter += ` && (${typeFilters.join(' || ')})`
      }
      // ... rest unchanged
```

Also update the `queryKeys.normalizedMappings` definition in `frontend/src/utils/queryKeys.ts` to include `sessionTypes`:

```typescript
normalizedMappings: (year: number, category: string, sessionCmId?: number, sessionTypes?: readonly string[]) =>
  ['normalized-mappings', year, category, sessionCmId, sessionTypes ? [...sessionTypes] : undefined] as const,
```

**Step 2: Update `useNormalizedMappings.test.ts`**

Update the source-content test that checks for `occurrence_count`:

```typescript
// Before:
it('should include original_value, occurrence_count, and confidence in grouped data', ...)
  expect(source).toContain('occurrence_count')

// After: remove the occurrence_count assertion, update test name
it('should include original_value and confidence in grouped data', async () => {
  const sourceContent = await import('./useNormalizedMappings?raw')
  const source = sourceContent.default

  expect(source).toContain('original_value')
  expect(source).toContain('confidence')
})
```

Update any comments referencing `occurrence_count`.

**Step 3: Update GeoAnalysis.tsx — pass `activeSessionTypes`**

Lines 85-101, add `activeSessionTypes` to each `useNormalizedMappings` call:

```typescript
const { data: citySources } = useNormalizedMappings(
  currentYear,
  categoryToDbCategory.city,
  needsMappings && activeLayers.has('city'),
  selectedSessionCmId ?? undefined,
  activeSessionTypes
)
const { data: schoolSources } = useNormalizedMappings(
  currentYear,
  categoryToDbCategory.school,
  needsMappings && activeLayers.has('school'),
  selectedSessionCmId ?? undefined,
  activeSessionTypes
)
const { data: synagogueSources } = useNormalizedMappings(
  currentYear,
  categoryToDbCategory.synagogue,
  needsMappings && activeLayers.has('synagogue'),
  selectedSessionCmId ?? undefined,
  activeSessionTypes
)
```

**Step 4: Run frontend tests**

```bash
cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run src/hooks/useNormalizedMappings.test.ts
```

**Step 5: Commit**

```
fix(frontend): filter normalized_mappings by session type

Source counts now respect the active session type filter (camp/quest/all)
instead of always fetching all session types. This aligns source counts
with the main registration counts.
```

---

## Task 4: Clean up vestigial references

**Files:**
- Modify: `frontend/src/types/pocketbase-types.ts:821`
- Modify: `frontend/src/hooks/useNormalizedMappings.ts` (comments)
- Modify: `frontend/src/hooks/useNormalizedMappings.test.ts:198-200` (comments)
- Modify: `tests/unit/api/test_metrics_normalized_geo.py:151,290` (comments)

**Step 1: Remove from TypeScript types**

In `pocketbase-types.ts`, remove line 821:
```typescript
  occurrence_count?: number
```

**Step 2: Update `useNormalizedMappings.ts` comments**

Remove references to "not from occurrence_count" in the file header and JSDoc:

Line 8: Change `mapping. Counts are computed dynamically by counting rows, not from occurrence_count.` to `mapping. Counts are computed dynamically by counting rows.`

Line 28: Change `Counts are computed by aggregating rows, not reading occurrence_count.` to `Counts are computed by aggregating rows.`

**Step 3: Update `useNormalizedMappings.test.ts` comments**

Line 198: Change `should compute counts dynamically from rows, not occurrence_count field` to `should compute counts dynamically from rows`

Line 200: Change `Count should be computed by counting rows, not reading occurrence_count` to `Count should be computed by counting rows`

Line 229: Change `Count should be 2 for Glenview Elementary (2 rows), not any occurrence_count field` to `Count should be 2 for Glenview Elementary (2 rows)`

**Step 4: Update `test_metrics_normalized_geo.py` comments**

Line 151: Change `count unique persons in the session, not occurrence_count.` to `count unique persons in the session.`

Line 290: Change `Counted from normalized_mappings (occurrence_count)` to `Counted from normalized_mappings (row count)`

**Step 5: Run all tests**

```bash
cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/unit/api/test_geo_service.py tests/unit/api/test_metrics_normalized_geo.py -v
cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run
```

**Step 6: Commit**

```
refactor(data): remove vestigial occurrence_count references

Drop the field from TypeScript types and update comments across
frontend and backend tests that referenced the removed field.
```

---

## Execution Order

Tasks 1-4 are sequential (each builds on the previous).

```
Task 1 (fix backend counting) → Task 2 (fix get_sources) → Task 3 (session type filter) → Task 4 (cleanup)
```
