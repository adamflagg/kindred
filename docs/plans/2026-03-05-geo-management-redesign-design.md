# Geo Management Page Redesign

Date: 2026-03-05
Status: Approved

## Overview

Redesign the admin geo data management page (`/admin/geo`) from a vertical-stack layout to a split-screen registrar workstation. The registrar's primary workflow is bulk-resolving non-canonical matched city/school/congregations, with a secondary focus on adding missing coordinates.

## Layout

### Page Structure

```
+--------+----------------------------+------------------------------------+
|        |       LEFT PANEL (40%)     |        RIGHT PANEL (60%)           |
| SIDE   |                            |                                    |
| BAR    |  Resolve Non-Canonicals    |  Canonical Reference List          |
|        |  (virtualized gap list)    |  (virtualized, sortable, search)   |
| City   |                            |                                    |
| School |  Add Coordinates           |  Expandable source rows            |
| Cong   |  [Auto-fill All]           |  with [Fix] for fuzzy matches      |
|        |  (tier 1 gaps)             |                                    |
+--------+----------------------------+------------------------------------+
| [x] Active enrollees only                          Total gaps: 23       |
+-------------------------------------------------------------------------+
```

### Sidebar
- ~60-80px wide, persistent narrow sidebar
- Icon + short label per category (city/school/congregation)
- Active category highlighted
- Click switches both panels to that category

### Global Bar
- "Active enrollees only" toggle (affects both panels)
- Total gaps remaining count
- Positioned at bottom to preserve vertical space for panels

### Split Screen
- 40/60 weighted split (adjustable later via CSS if needed)
- Both panels fill available viewport height, scroll independently

## Left Panel

### Top Section: Resolve Non-Canonicals
- Header: "Resolve Non-Canonicals" + count badge
- Virtualized list (fixed row height via `useVirtualTable`)
- Merges tier 2 (grouped) and tier 3 (ungrouped) into one list
- Sorted by camper count descending (highest-impact first)
- Each row:
  - Red dot (grouped/ambiguous) or gray dot (ungrouped/no match)
  - Name, camper count, [Resolve] button
  - Second line: variant count + match status
- [Resolve] opens the shared ResolveDialog modal

### Bottom Section: Add Coordinates
- Header: "Add Coordinates" + count badge + [Auto-fill All] button
- Tier 1 gaps (canonical entries missing coords)
- Each row:
  - Canonical name, city/state (pre-filled from static data, "?" if unknown)
  - Camper count, ambiguity warning if applicable
  - [Add] button opens coords modal
- [Auto-fill All] triggers batch auto-resolve

## Right Panel: Canonical Reference List

### Header
- Category name + total count
- Sort toggles: Popular (camper count desc, default) / A-Z (alphabetical)
- Search input: instant client-side filter across name, city, state

### Collapsed Row
- Single-line, dense: chevron, canonical name, city/state, source badge (NCES/PSS/SimpleMaps/Manual), camper count
- 0-camper entries shown dimmed

### Expanded Row
- Sources loaded lazily on expand (`useCanonicalSources` hook)
- Each source: original value, count, confidence %
- Exact matches (100%): no action button
- Fuzzy matches (<100%): [Fix] button opens ResolveDialog pre-filled with that original_value
- Dynamic row height via `useVirtualTable` with `enableDynamicHeights`

## Resolve Dialog (Modal)

Shared modal used from three entry points:
1. Left panel [Resolve] (non-canonical gap)
2. Left panel [Add] (missing coords)
3. Right panel [Fix] (reassign a source)

### Mode A: Resolve Non-Canonical (entry points 1 & 3)
- Title: "Resolve: {gap_name}"
- Typeahead search: instant client-side from prefetched canonicals
- Results show: canonical name, city/state, source badge
- Selecting a match highlights it for confirmation
- "Create new canonical entry" expands inline fields:
  - Canonical name (pre-filled with gap name)
  - City, State (auto-filled via Nominatim)
- Save creates `alias` override (match) or `canonical` override (new entry)

### Mode B: Add Coordinates (entry point 2)
- Title: "Add Location: {canonical_name}"
- Pre-fills city/state from static data on open
- Fires Nominatim lookup in background, fills lat/lng when ready
- All fields editable (city, state, lat, lng)
- Loading state while geocoding, then confirmation
- Save creates `canonical` override with coords

## Batch Auto-Resolve Coordinates

### Endpoint
`POST /api/geo/batch-resolve-coords`

### Parameters
- `category` (required): city/school/congregation
- `year` (required): scope year

### Logic
1. Load all canonical-missing-coords entries for category+year
2. For each entry:
   - Load city/state from static data
   - Check ambiguity: any other entry with same canonical name but different city/state?
   - If unambiguous: Nominatim lookup with "{name}, {city}, {state}"
   - Verify address components match known city/state
   - If match: create `canonical` override with coords, set `nominatim_status = 'resolved'`
   - If ambiguous/no-result/mismatch: create override with `nominatim_status = 'ambiguous'` or `'no_result'`
3. Rate limiting: 429 exponential backoff (2s start, 30s max, 3 retries per entry)
4. If persistent throttling: pause batch, return partial results

### Response
```json
{
  "resolved": 12,
  "skipped": 3,
  "skipped_names": ["Lincoln Elementary", "Springfield Middle"],
  "paused": false
}
```

### Frontend UX
- Confirmation prompt before starting
- Progress indicator in button: "Resolving 8/15..."
- Toast on completion: "12 entries resolved. 3 need manual review."
- Both panels refresh

## Schema Changes

### geo_overrides: Add `nominatim_status` field
- Type: select
- Values: null (not checked), `resolved`, `no_result`, `ambiguous`
- Purpose: track which entries have been checked by Nominatim so batch runs skip them
- Registrar can delete an override to un-mark and retry

## Technical Approach

### Frontend
- Full rebuild of page components (new shell, new panels)
- Reuse existing hooks: `useGeoGaps`, `useAllCanonicals`, `useCanonicalSources`, `useGeoOverrides`, `useCreateOverride`, `useDeleteOverride`
- Reuse `useVirtualTable` hook for both panels
- Enhance `ResolveGapDialog` or rebuild as `ResolveDialog`
- Sierra Lodge theme, dense layout, minimal whitespace

### Backend
- One new endpoint: `POST /api/geo/batch-resolve-coords`
- One schema migration: `nominatim_status` field on `geo_overrides`
- All existing endpoints reused unchanged

### Performance
- All canonicals prefetched with 1-hour cache
- Virtualized rendering for both panels (only visible rows rendered)
- Lazy source loading on card expand
- Client-side search (no API round-trips)
- No slow initial page load
