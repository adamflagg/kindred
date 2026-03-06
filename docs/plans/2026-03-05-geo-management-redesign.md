# Geo Management Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the admin geo management page from a vertical-stack layout to a split-screen registrar workstation with batch auto-resolve, virtualized lists, and dense Sierra Lodge styling.

**Architecture:** Full frontend rebuild replacing GeoDataTab and all sub-components. Persistent narrow sidebar for category switching, 40/60 split-screen with independent scrolling panels, virtualized via existing `useVirtualTable` hook. One new backend endpoint for batch coordinate auto-resolve. One schema migration adding `nominatim_status` to `geo_overrides`. All existing hooks and API endpoints reused.

**Tech Stack:** React 19, TypeScript 5.8+, @tanstack/react-virtual (via useVirtualTable), @tanstack/react-query, Tailwind CSS (Sierra Lodge theme), FastAPI, PocketBase, Nominatim geocoding API.

**Worktree:** `/home/adam/kindred-worktrees/geo-management` on branch `feature/geo-management`

**Design doc:** `docs/plans/2026-03-05-geo-management-redesign-design.md`

---

## Task 1: Schema Migration — Add `nominatim_status` to `geo_overrides`

**Files:**
- Create: `pocketbase/pb_migrations/1500000067_geo_overrides_nominatim_status.js`

**Step 1: Write the migration**

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    collection.fields.add(
      new Field({
        name: "nominatim_status",
        type: "select",
        required: false,
        values: ["resolved", "no_result", "ambiguous"],
        maxSelect: 1,
      })
    )

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    collection.fields.removeByName("nominatim_status")

    app.save(collection)
  }
)
```

**Step 2: Verify Go builds**

Run: `cd /home/adam/kindred-worktrees/geo-management/pocketbase && go build .`
Expected: Clean build, no errors.

**Step 3: Commit**

```
feat(pb): add nominatim_status field to geo_overrides
```

---

## Task 2: Backend — Batch Resolve Coords Endpoint (Tests)

**Files:**
- Modify: `tests/unit/api/test_geo_service.py`

**Step 1: Write failing tests for batch resolve**

Add a new test class `TestBatchResolveCoords` to the existing test file. These tests verify:
- Unambiguous entries get resolved with Nominatim coords
- Ambiguous entries (same name, different city/state) get skipped
- Entries with existing `nominatim_status` get skipped
- Nominatim failures set `no_result` status
- Response includes resolved/skipped counts

```python
class TestBatchResolveCoords:
    """Tests for batch_resolve_coords service method."""

    @pytest.fixture
    def geo_service(self, mock_app):
        return GeoService(mock_app)

    @pytest.mark.asyncio
    async def test_resolves_unambiguous_entry(self, geo_service, mock_app):
        """Unambiguous canonical missing coords gets resolved via Nominatim."""
        # Gap: "Mark Day School" in San Rafael, CA — only one in static data
        mapping = _make_mapping_record(
            "Mark Day School", "Mark Day School", "school", confidence=1.0, year=2025
        )
        mock_app.find_all_records.side_effect = [
            [mapping],  # normalized_mappings
            [],  # existing overrides
        ]

        with (
            patch.object(geo_service, "_load_static_coords", return_value={}),
            patch.object(
                geo_service, "_load_static_location",
                return_value={"Mark Day School": {"city": "San Rafael", "state": "CA"}},
            ),
            patch.object(
                geo_service, "_load_static_lookup",
                return_value={"mark day school": "Mark Day School"},
            ),
            patch.object(
                geo_service, "_check_name_ambiguity",
                return_value=False,
            ),
            patch.object(
                geo_service, "geocode_location",
                return_value=(37.96, -122.535),
            ),
        ):
            result = await geo_service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 1
        assert result["skipped"] == 0
        assert len(result["skipped_names"]) == 0

    @pytest.mark.asyncio
    async def test_skips_ambiguous_entry(self, geo_service, mock_app):
        """Ambiguous canonical (same name in multiple cities) gets skipped."""
        mapping = _make_mapping_record(
            "Lincoln Elementary", "Lincoln Elementary", "school", confidence=1.0, year=2025
        )
        mock_app.find_all_records.side_effect = [
            [mapping],
            [],  # no existing overrides
        ]

        with (
            patch.object(geo_service, "_load_static_coords", return_value={}),
            patch.object(
                geo_service, "_load_static_location",
                return_value={"Lincoln Elementary": {"city": "Oakland", "state": "CA"}},
            ),
            patch.object(
                geo_service, "_load_static_lookup",
                return_value={
                    "lincoln elementary": "Lincoln Elementary",
                },
            ),
            patch.object(
                geo_service, "_check_name_ambiguity",
                return_value=True,
            ),
        ):
            result = await geo_service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 1
        assert "Lincoln Elementary" in result["skipped_names"]

    @pytest.mark.asyncio
    async def test_skips_previously_checked(self, geo_service, mock_app):
        """Entries with existing nominatim_status override get skipped."""
        mapping = _make_mapping_record(
            "Oak Valley Middle", "Oak Valley Middle", "school", confidence=1.0, year=2025
        )
        existing_override = _make_override_record(
            category="school",
            canonical_name="Oak Valley Middle",
            override_type="canonical",
            nominatim_status="no_result",
            year=2025,
        )
        mock_app.find_all_records.side_effect = [
            [mapping],
            [existing_override],  # has nominatim_status
        ]

        with (
            patch.object(geo_service, "_load_static_coords", return_value={}),
            patch.object(
                geo_service, "_load_static_lookup",
                return_value={"oak valley middle": "Oak Valley Middle"},
            ),
        ):
            result = await geo_service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 0  # not counted as skipped, just filtered out

    @pytest.mark.asyncio
    async def test_nominatim_failure_sets_no_result(self, geo_service, mock_app):
        """Nominatim returning no results sets nominatim_status='no_result'."""
        mapping = _make_mapping_record(
            "Fictional Academy", "Fictional Academy", "school", confidence=1.0, year=2025
        )
        mock_app.find_all_records.side_effect = [
            [mapping],
            [],
        ]

        with (
            patch.object(geo_service, "_load_static_coords", return_value={}),
            patch.object(
                geo_service, "_load_static_location",
                return_value={"Fictional Academy": {"city": "Nowhereville", "state": "CA"}},
            ),
            patch.object(
                geo_service, "_load_static_lookup",
                return_value={"fictional academy": "Fictional Academy"},
            ),
            patch.object(
                geo_service, "_check_name_ambiguity",
                return_value=False,
            ),
            patch.object(
                geo_service, "geocode_location",
                return_value=None,
            ),
        ):
            result = await geo_service.batch_resolve_coords("school", 2025)

        assert result["resolved"] == 0
        assert result["skipped"] == 1

    @pytest.mark.asyncio
    async def test_returns_summary_counts(self, geo_service, mock_app):
        """Response includes resolved, skipped, skipped_names, and paused."""
        mock_app.find_all_records.side_effect = [[], []]

        with (
            patch.object(geo_service, "_load_static_coords", return_value={}),
            patch.object(geo_service, "_load_static_lookup", return_value={}),
        ):
            result = await geo_service.batch_resolve_coords("school", 2025)

        assert "resolved" in result
        assert "skipped" in result
        assert "skipped_names" in result
        assert "paused" in result
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/unit/api/test_geo_service.py::TestBatchResolveCoords -v`
Expected: FAIL — `batch_resolve_coords` method doesn't exist yet.

**Step 3: Commit tests**

```
test(api): add batch_resolve_coords tests for geo service
```

---

## Task 3: Backend — Batch Resolve Coords Endpoint (Implementation)

**Files:**
- Modify: `api/services/geo_service.py` — add `batch_resolve_coords` method and `_check_name_ambiguity` helper
- Modify: `api/routers/geo.py` — add `POST /api/geo/batch-resolve-coords` endpoint
- Modify: `api/schemas/geo.py` — add `BatchResolveResponse` model and update `OverrideResponse` with `nominatim_status`

**Step 1: Add schema**

In `api/schemas/geo.py`, add:

```python
class BatchResolveResponse(BaseModel):
    resolved: int
    skipped: int
    skipped_names: list[str]
    paused: bool = False
```

Update `OverrideResponse` to include:
```python
    nominatim_status: str | None = None
```

**Step 2: Add service method**

In `api/services/geo_service.py`, add `batch_resolve_coords` and `_check_name_ambiguity`:

```python
def _check_name_ambiguity(self, category: str, canonical_name: str) -> bool:
    """Check if a canonical name exists in multiple locations in static data."""
    location_data = _load_static_location(category)
    lookup = _load_static_lookup(category)

    # Find all entries in lookup that resolve to different canonical names
    # but share the same display name (case-insensitive)
    target_lower = canonical_name.lower()
    matching_canonicals = [
        v for k, v in lookup.items()
        if v.lower() == target_lower or k == target_lower
    ]
    if len(matching_canonicals) <= 1:
        return False

    # Check if they resolve to different locations
    locations = set()
    for canon in matching_canonicals:
        loc = location_data.get(canon, {})
        city = loc.get("city", "")
        state = loc.get("state", "")
        if city or state:
            locations.add((city.lower(), state.lower()))

    return len(locations) > 1

async def batch_resolve_coords(
    self,
    category: str,
    year: int,
) -> dict[str, Any]:
    """Batch auto-resolve coordinates for unambiguous canonical entries."""
    import asyncio

    static_coords = _load_static_coords(category)
    static_lookup = _load_static_lookup(category)
    static_location = _load_static_location(category)

    # Find canonical entries missing coords
    mappings = await self._fetch_mappings(category, year)
    canonical_names = {m.get("normalized_value") for m in mappings if m.get("normalized_value")}

    # Filter to entries missing coords in both static and overrides
    missing_coords = [
        name for name in canonical_names
        if name in {v for v in static_lookup.values()}
        and name not in static_coords
    ]

    # Filter out entries that already have nominatim_status overrides
    existing_overrides = await self._fetch_overrides_for_batch(category, year, missing_coords)
    checked_names = {
        o.get("canonical_name") for o in existing_overrides
        if o.get("nominatim_status")
    }
    # Also filter out entries that already have coord overrides
    coord_override_names = {
        o.get("canonical_name") for o in existing_overrides
        if o.get("lat") is not None and o.get("lng") is not None
    }
    candidates = [
        name for name in missing_coords
        if name not in checked_names and name not in coord_override_names
    ]

    resolved = 0
    skipped = 0
    skipped_names: list[str] = []

    for name in candidates:
        # Check ambiguity
        if self._check_name_ambiguity(category, name):
            skipped += 1
            skipped_names.append(name)
            # Create override marking as ambiguous
            await self._create_nominatim_status_override(
                category, name, year, "ambiguous",
                static_location.get(name, {})
            )
            continue

        # Get location context
        location = static_location.get(name, {})
        city = location.get("city", "")
        state = location.get("state", "")

        # Geocode
        coords = await self.geocode_location(name, city, state)

        if coords:
            lat, lng = coords
            await self._create_coord_override(
                category, name, year, city, state, lat, lng
            )
            resolved += 1
        else:
            skipped += 1
            skipped_names.append(name)
            await self._create_nominatim_status_override(
                category, name, year, "no_result", location
            )

        # Rate limit: 1 req/sec for Nominatim
        await asyncio.sleep(1.0)

    return {
        "resolved": resolved,
        "skipped": skipped,
        "skipped_names": skipped_names,
        "paused": False,
    }
```

The helper methods `_fetch_mappings`, `_fetch_overrides_for_batch`, `_create_coord_override`, and `_create_nominatim_status_override` interact with PocketBase to fetch/create records. Implement them using the same patterns as existing `create_override`.

**Step 3: Add router endpoint**

In `api/routers/geo.py`, add:

```python
@router.post("/geo/batch-resolve-coords", response_model=BatchResolveResponse)
async def batch_resolve_coords(
    category: str = Query(...),
    year: int = Query(...),
    user: AuthUser = Depends(get_current_user),
) -> BatchResolveResponse:
    """Batch auto-resolve coordinates for unambiguous canonical entries."""
    service = GeoService(get_app())
    result = await service.batch_resolve_coords(category, year)
    return BatchResolveResponse(**result)
```

**Step 4: Run tests**

Run: `cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/unit/api/test_geo_service.py::TestBatchResolveCoords -v`
Expected: All tests PASS.

**Step 5: Run full test suite + linting**

Run: `cd /home/adam/kindred-worktrees/geo-management && uv run ruff check --fix . && uv run ruff format . && uv run mypy bunking api`
Expected: Clean.

**Step 6: Commit**

```
feat(api): add batch-resolve-coords endpoint with Nominatim auto-fill
```

---

## Task 4: Frontend — Update Types and Service for Batch Resolve

**Files:**
- Modify: `frontend/src/services/geoService.ts` — add `BatchResolveResponse` type and `batchResolveCoords` function, add `nominatim_status` to `GeoOverride`
- Modify: `frontend/src/hooks/useGeoData.ts` — add `useBatchResolveCoords` mutation hook

**Step 1: Add types and API function to geoService.ts**

```typescript
export interface BatchResolveResponse {
  resolved: number
  skipped: number
  skipped_names: string[]
  paused: boolean
}

// Add to GeoOverride interface:
//   nominatim_status: string | null

export async function batchResolveCoords(
  category: string,
  year: number,
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
): Promise<BatchResolveResponse> {
  const params = new URLSearchParams({ category, year: String(year) })
  const response = await fetchWithAuth(`${API_BASE}/batch-resolve-coords?${params}`, {
    method: 'POST',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { detail?: string }).detail ?? 'Failed to batch resolve coords')
  }
  return response.json()
}
```

**Step 2: Add mutation hook to useGeoData.ts**

```typescript
export function useBatchResolveCoords(category: string, year: number) {
  const { fetchWithAuth } = useAuthFetch()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => batchResolveCoords(category, year, fetchWithAuth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoGaps(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoOverrides(category, year) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.geoAllCanonicals(category, year) })
    },
  })
}
```

**Step 3: Commit**

```
feat(frontend): add batch resolve coords service and hook
```

---

## Task 5: Frontend — Page Shell with Sidebar (Tests)

**Files:**
- Create: `frontend/src/components/admin/geo/__tests__/GeoManagementPage.test.tsx`

**Step 1: Write tests for the page shell**

Test that:
- Sidebar renders 3 category items (city, school, congregation)
- Clicking a sidebar item updates the active category
- Split-screen layout renders left and right panels
- Global "Active enrollees only" toggle exists
- Total gaps count displays
- Default category is city

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { GeoManagementPage } from '../GeoManagementPage'

// Mock hooks
vi.mock('../../../../hooks/useGeoData', () => ({
  useGeoGaps: vi.fn(() => ({
    data: {
      canonical_no_coords: [],
      non_canonical_grouped: [{ name: 'Test', count: 5, percentage: 10, source_count: 1 }],
      non_canonical_ungrouped: [],
      total_gaps: 1,
    },
    isLoading: false,
  })),
  useAllCanonicals: vi.fn(() => ({
    data: { results: [] },
    isLoading: false,
  })),
  useGeoOverrides: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateOverride: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteOverride: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCanonicalSearch: vi.fn(() => ({ data: null, isLoading: false })),
  useCanonicalSources: vi.fn(() => ({ data: null, isLoading: false })),
  useBatchResolveCoords: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))
vi.mock('../../../../hooks/useCurrentYear', () => ({
  useYear: vi.fn(() => 2025),
}))

function renderPage(initialPath = '/admin/geo/cities') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <GeoManagementPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('GeoManagementPage', () => {
  it('renders sidebar with three category items', () => {
    renderPage()
    expect(screen.getByText('Cities')).toBeInTheDocument()
    expect(screen.getByText('Schools')).toBeInTheDocument()
    expect(screen.getByText('Congregations')).toBeInTheDocument()
  })

  it('renders split-screen with left and right panels', () => {
    renderPage()
    expect(screen.getByTestId('left-panel')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()
  })

  it('renders active enrollees toggle', () => {
    renderPage()
    expect(screen.getByLabelText(/active enrollees/i)).toBeInTheDocument()
  })

  it('shows total gaps count', () => {
    renderPage()
    expect(screen.getByText(/1 gap/i)).toBeInTheDocument()
  })

  it('switches category on sidebar click', async () => {
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByText('Schools'))
    // Verify the Schools sidebar item is active
    expect(screen.getByText('Schools').closest('[data-active]')).toHaveAttribute(
      'data-active',
      'true'
    )
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run src/components/admin/geo/__tests__/GeoManagementPage.test.tsx`
Expected: FAIL — `GeoManagementPage` doesn't exist.

**Step 3: Commit tests**

```
test(frontend): add GeoManagementPage shell tests
```

---

## Task 6: Frontend — Page Shell with Sidebar (Implementation)

**Files:**
- Create: `frontend/src/components/admin/geo/GeoManagementPage.tsx`
- Modify: `frontend/src/components/admin/GeoDataTab.tsx` — re-export new component
- Modify: `frontend/src/components/admin/geoConstants.ts` — add sidebar config

**Step 1: Update geoConstants with sidebar config**

Add to `geoConstants.ts`:

```typescript
import { Building2, School, Landmark } from 'lucide-react'

export const CATEGORY_SIDEBAR = [
  { id: 'city' as const, label: 'Cities', icon: Building2, path: '/admin/geo/cities' },
  { id: 'school' as const, label: 'Schools', icon: School, path: '/admin/geo/schools' },
  { id: 'congregation' as const, label: 'Congregations', icon: Landmark, path: '/admin/geo/congregations' },
]
```

**Step 2: Build GeoManagementPage**

Create `GeoManagementPage.tsx` — the new page shell with:
- Persistent narrow sidebar (60-80px, icons + labels)
- 40/60 split-screen grid
- Global bottom bar with active-only toggle + total gaps
- State: `activeOnly`, `category` (from URL), `resolveDialog`
- Placeholder `<div>` for left and right panels (wired in later tasks)

```typescript
import { useState, useCallback, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { MapPin } from 'lucide-react'
import { CATEGORY_SIDEBAR, SUB_TAB_TO_CATEGORY, getActiveSubTab } from '../geoConstants'
import type { GeoCategory } from '../geoConstants'
import { useGeoGaps } from '../../../hooks/useGeoData'
import { useYear } from '../../../hooks/useCurrentYear'

export function GeoManagementPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const year = useYear()
  const activeSubTab = getActiveSubTab(location.pathname)
  const category = (SUB_TAB_TO_CATEGORY[activeSubTab] ?? 'city') as GeoCategory
  const [activeOnly, setActiveOnly] = useState(true)

  const { data: gaps } = useGeoGaps(category, year, activeOnly)
  const totalGaps = gaps?.total_gaps ?? 0

  // Default redirect
  useEffect(() => {
    if (location.pathname === '/admin/geo' || location.pathname === '/admin/geo/') {
      void navigate('/admin/geo/cities', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="bg-forest-100 dark:bg-forest-800 rounded-lg p-2">
          <MapPin className="text-forest-700 dark:text-forest-300 h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-foreground text-lg font-bold">Geographic Data</h2>
          <p className="text-muted-foreground text-xs">
            Manage canonical names, coordinates, and normalization overrides
          </p>
        </div>
      </div>

      {/* Main content: sidebar + split panels */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="border-border flex w-16 flex-col gap-1 border-r px-1.5 py-2">
          {CATEGORY_SIDEBAR.map((item) => {
            const Icon = item.icon
            const isActive = category === item.id
            return (
              <Link
                key={item.id}
                to={item.path}
                data-active={isActive}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-center transition-colors ${
                  isActive
                    ? 'bg-forest-100 text-forest-800 dark:bg-forest-800 dark:text-forest-200'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Split panels */}
        <div className="grid min-h-0 flex-1 grid-cols-[2fr_3fr]">
          <div data-testid="left-panel" className="border-border overflow-y-auto border-r p-3">
            {/* Left panel placeholder — wired in Task 8 */}
            <p className="text-muted-foreground text-sm">Left panel: gaps</p>
          </div>
          <div data-testid="right-panel" className="overflow-y-auto p-3">
            {/* Right panel placeholder — wired in Task 10 */}
            <p className="text-muted-foreground text-sm">Right panel: canonicals</p>
          </div>
        </div>
      </div>

      {/* Global bottom bar */}
      <div className="border-border bg-muted/30 flex items-center justify-between border-t px-4 py-2">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="checkbox-lodge"
            aria-label="Active enrollees only"
          />
          Active enrollees only
        </label>
        <span className="text-muted-foreground text-sm">
          {totalGaps} {totalGaps === 1 ? 'gap' : 'gaps'} remaining
        </span>
      </div>
    </div>
  )
}
```

**Step 3: Update GeoDataTab to use new component**

Replace the contents of `GeoDataTab.tsx` with a re-export:

```typescript
export { GeoManagementPage as GeoDataTab } from './geo/GeoManagementPage'
```

This preserves the lazy import in App.tsx without changes.

**Step 4: Run tests**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run src/components/admin/geo/__tests__/GeoManagementPage.test.tsx`
Expected: All tests PASS.

**Step 5: Run linting**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npm run lint`
Expected: Clean.

**Step 6: Commit**

```
feat(frontend): add GeoManagementPage shell with sidebar and split-screen
```

---

## Task 7: Frontend — Left Panel: Non-Canonicals List (Tests)

**Files:**
- Create: `frontend/src/components/admin/geo/__tests__/NonCanonicalsPanel.test.tsx`

**Step 1: Write tests**

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { NonCanonicalsPanel } from '../NonCanonicalsPanel'
import type { GapItem } from '../../../../services/geoService'

const grouped: GapItem[] = [
  { name: 'Hillcrest High', count: 14, percentage: 8.2, source_count: 3 },
  { name: 'Riverside Elem', count: 5, percentage: 2.9, source_count: 2 },
]
const ungrouped: GapItem[] = [
  { name: 'Mapleton Prep', count: 2, percentage: 1.2, source_count: 0 },
]

describe('NonCanonicalsPanel', () => {
  it('renders merged list sorted by count descending', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    const names = screen.getAllByTestId('gap-name').map((el) => el.textContent)
    expect(names).toEqual(['Hillcrest High', 'Riverside Elem', 'Mapleton Prep'])
  })

  it('shows red dot for grouped, gray dot for ungrouped', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    const dots = screen.getAllByTestId('gap-indicator')
    // First two are grouped (red), last is ungrouped (gray)
    expect(dots[0]).toHaveClass('bg-red-500')
    expect(dots[2]).toHaveClass('bg-stone-400')
  })

  it('calls onResolve with name and type when Resolve clicked', async () => {
    const onResolve = vi.fn()
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={onResolve} />)
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button', { name: /resolve/i })
    await user.click(buttons[0])
    expect(onResolve).toHaveBeenCalledWith('Hillcrest High', 'non_canonical_grouped')
  })

  it('shows count badge in header', () => {
    render(<NonCanonicalsPanel grouped={grouped} ungrouped={ungrouped} onResolve={vi.fn()} />)
    expect(screen.getByText('3')).toBeInTheDocument() // 2 grouped + 1 ungrouped
  })

  it('shows empty state when no gaps', () => {
    render(<NonCanonicalsPanel grouped={[]} ungrouped={[]} onResolve={vi.fn()} />)
    expect(screen.getByText(/all resolved/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run src/components/admin/geo/__tests__/NonCanonicalsPanel.test.tsx`
Expected: FAIL.

**Step 3: Commit**

```
test(frontend): add NonCanonicalsPanel tests
```

---

## Task 8: Frontend — Left Panel: Non-Canonicals List (Implementation)

**Files:**
- Create: `frontend/src/components/admin/geo/NonCanonicalsPanel.tsx`

**Step 1: Implement the component**

A compact virtualized list merging tier 2 (grouped) and tier 3 (ungrouped) gaps. Each row shows: indicator dot (red=grouped, gray=ungrouped), name, camper count, variant info, [Resolve] button. Sorted by count desc. Uses `useVirtualTable` with `compact` row height preset.

Key implementation details:
- Merge grouped + ungrouped into one array, tag each with its `gapType`
- Sort by count descending
- Each item needs `{ id: string }` for useVirtualTable — use `name` as id
- Header: "Resolve Non-Canonicals" + count badge
- Empty state: green checkmark "All resolved"

**Step 2: Wire into GeoManagementPage left panel**

Replace the left panel placeholder in `GeoManagementPage.tsx` with `<NonCanonicalsPanel>`, passing gaps data.

**Step 3: Run tests**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run src/components/admin/geo/__tests__/NonCanonicalsPanel.test.tsx`
Expected: PASS.

**Step 4: Commit**

```
feat(frontend): add NonCanonicalsPanel with virtualized gap list
```

---

## Task 9: Frontend — Left Panel: Add Coordinates Section (Tests)

**Files:**
- Create: `frontend/src/components/admin/geo/__tests__/AddCoordsPanel.test.tsx`

**Step 1: Write tests**

Test:
- Renders tier 1 gaps with canonical name, city/state, camper count
- Shows "?" for unknown city/state
- Shows ambiguity warning badge for entries flagged ambiguous
- [Add] button calls `onAdd` with canonical name
- [Auto-fill All] button calls `onBatchResolve`
- Shows progress state during batch resolve
- Empty state when no missing coords

**Step 2: Run tests — expect FAIL**

**Step 3: Commit**

```
test(frontend): add AddCoordsPanel tests
```

---

## Task 10: Frontend — Left Panel: Add Coordinates Section (Implementation)

**Files:**
- Create: `frontend/src/components/admin/geo/AddCoordsPanel.tsx`

**Step 1: Implement**

- Header: "Add Coordinates" + count badge + [Auto-fill All] button
- List of tier 1 gaps: canonical name, city/state (from static data), camper count
- [Add] button per row opens coords modal (wired via callback)
- [Auto-fill All] triggers `useBatchResolveCoords` mutation, shows progress, toast on completion
- City/state comes from `CanonicalEntry.city` / `.state` fields (already returned by gaps endpoint through static data)

**Step 2: Wire into GeoManagementPage left panel below NonCanonicalsPanel**

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```
feat(frontend): add AddCoordsPanel with batch auto-fill
```

---

## Task 11: Frontend — Right Panel: Canonical Reference List (Tests)

**Files:**
- Create: `frontend/src/components/admin/geo/__tests__/CanonicalReferenceList.test.tsx`

**Step 1: Write tests**

Test:
- Renders virtualized list of canonical entries
- Collapsed row shows: name, city/state, source badge, camper count
- Sort toggle: Popular (default, by count) / A-Z (alphabetical)
- Search input filters entries client-side (name, city, state)
- Expanding a row shows source variants with confidence %
- [Fix] button appears only on fuzzy matches (confidence < 1.0)
- [Fix] calls `onReassignSource` with original_value
- 0-camper entries shown dimmed

**Step 2: Run tests — expect FAIL**

**Step 3: Commit**

```
test(frontend): add CanonicalReferenceList tests
```

---

## Task 12: Frontend — Right Panel: Canonical Reference List (Implementation)

**Files:**
- Create: `frontend/src/components/admin/geo/CanonicalReferenceList.tsx`

**Step 1: Implement**

- Uses `useAllCanonicals` (prefetched, 1hr cache) for the full list
- Client-side search filter (name, city, state substring match)
- Sort state: `'popular' | 'alpha'`
- `useVirtualTable` with `enableDynamicHeights` and `expandedRows` tracking
- Collapsed row: single line with name, city/state badge, source badge, camper count icon
- Expanded row: lazy-loaded sources via `useCanonicalSources`, shows original_value, count, confidence %, [Fix] button on confidence < 1.0
- Source badge colors: forest (NCES/PSS), amber (SimpleMaps), stone (Manual/Curated)
- `onReassignSource` callback for [Fix] button

**Step 2: Wire into GeoManagementPage right panel**

**Step 3: Run tests — expect PASS**

**Step 4: Run linting**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npm run lint`

**Step 5: Commit**

```
feat(frontend): add CanonicalReferenceList with virtualized expand/search
```

---

## Task 13: Frontend — Enhanced Resolve Dialog (Tests)

**Files:**
- Create: `frontend/src/components/admin/geo/__tests__/ResolveDialog.test.tsx`

**Step 1: Write tests**

Test the enhanced dialog covering both modes:

**Mode A (resolve non-canonical / reassign source):**
- Typeahead searches client-side from prefetched canonicals
- Selecting a match and clicking Save creates alias override
- "Create new" mode shows name/city/state fields
- Creating new triggers Nominatim auto-fill for city/state
- Pre-fills gap name in search and create-new name field

**Mode B (add coordinates):**
- Shows city/state pre-filled from static data
- Shows lat/lng fields
- Fires Nominatim lookup on open, fills coords when ready
- Loading state while geocoding
- Save creates canonical override with coords

**Step 2: Run tests — expect FAIL**

**Step 3: Commit**

```
test(frontend): add ResolveDialog tests for both modes
```

---

## Task 14: Frontend — Enhanced Resolve Dialog (Implementation)

**Files:**
- Create: `frontend/src/components/admin/geo/ResolveDialog.tsx` (new, replaces old `ResolveGapDialog.tsx`)

**Step 1: Implement**

Enhanced dialog with two modes determined by `gapType` prop:

**Mode A** (`gapType !== 'canonical_no_coords'`):
- Instant typeahead: filter `useAllCanonicals` data client-side (no API calls on type)
- Results: canonical name, city/state, source badge
- Select → highlight → Save creates `alias` override
- "Create new" inline form: name (pre-filled), city, state
- On "Create new", fire Nominatim for city/state auto-fill

**Mode B** (`gapType === 'canonical_no_coords'`):
- Pre-fill city/state from the gap item's known location data
- On open, fire `geocode_location` via a new lightweight endpoint or client-side fetch to Nominatim
- Show loading spinner → fill lat/lng
- All fields editable
- Save creates `canonical` override with coords

Both modes use the existing `useCreateOverride` mutation.

**Step 2: Wire into GeoManagementPage — replace ResolveGapDialog import**

**Step 3: Run tests — expect PASS**

**Step 4: Commit**

```
feat(frontend): add enhanced ResolveDialog with typeahead and coords modes
```

---

## Task 15: Frontend — Integration and Cleanup

**Files:**
- Modify: `frontend/src/components/admin/geo/GeoManagementPage.tsx` — wire all state and callbacks
- Delete: `frontend/src/components/admin/geo/GapsPanel.tsx`
- Delete: `frontend/src/components/admin/geo/CanonicalBrowser.tsx`
- Delete: `frontend/src/components/admin/geo/CanonicalCard.tsx`
- Delete: `frontend/src/components/admin/geo/ResolveGapDialog.tsx`
- Delete: `frontend/src/components/admin/geo/GapsPanel.test.tsx`
- Delete: `frontend/src/components/admin/geo/CanonicalBrowser.test.tsx`

**Step 1: Wire GeoManagementPage state**

Connect all the pieces:
- `resolveDialog` state → `ResolveDialog` modal
- `NonCanonicalsPanel.onResolve` → opens dialog in Mode A
- `AddCoordsPanel.onAdd` → opens dialog in Mode B
- `AddCoordsPanel.onBatchResolve` → `useBatchResolveCoords`
- `CanonicalReferenceList.onReassignSource` → opens dialog in Mode A (pre-filled with source original_value)
- `activeOnly` state flows to both panels via hooks
- `category` from sidebar drives all data hooks

**Step 2: Delete old components**

Remove GapsPanel, CanonicalBrowser, CanonicalCard, ResolveGapDialog, and their tests. These are fully replaced.

**Step 3: Run full frontend test suite**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run`
Expected: All tests pass.

**Step 4: Run linting**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npm run lint`
Expected: Clean.

**Step 5: Commit**

```
feat(frontend): wire GeoManagementPage integration and remove old components
```

---

## Task 16: Full Verification

**Step 1: Run all backend tests**

Run: `cd /home/adam/kindred-worktrees/geo-management && uv run pytest tests/ -v`
Expected: All pass.

**Step 2: Run all frontend tests**

Run: `cd /home/adam/kindred-worktrees/geo-management/frontend && npx vitest run`
Expected: All pass.

**Step 3: Run pre-push checks**

Run:
```bash
cd /home/adam/kindred-worktrees/geo-management
uv run ruff check --fix .
uv run ruff format .
uv run mypy bunking api
cd frontend && npm run lint
```
Expected: All clean.

**Step 4: Run Go build**

Run: `cd /home/adam/kindred-worktrees/geo-management/pocketbase && go build .`
Expected: Clean build.

**Step 5: Commit any formatting fixes**

```
chore: formatting and lint fixes
```

---

## Summary of Files Changed

### Created
| File | Purpose |
|------|---------|
| `pocketbase/pb_migrations/1500000067_geo_overrides_nominatim_status.js` | Schema: nominatim_status field |
| `frontend/src/components/admin/geo/GeoManagementPage.tsx` | New page shell with sidebar + split-screen |
| `frontend/src/components/admin/geo/NonCanonicalsPanel.tsx` | Left panel top: non-canonical gap list |
| `frontend/src/components/admin/geo/AddCoordsPanel.tsx` | Left panel bottom: missing coords + batch resolve |
| `frontend/src/components/admin/geo/CanonicalReferenceList.tsx` | Right panel: virtualized canonical list |
| `frontend/src/components/admin/geo/ResolveDialog.tsx` | Enhanced modal with typeahead + coords modes |
| `frontend/src/components/admin/geo/__tests__/GeoManagementPage.test.tsx` | Page shell tests |
| `frontend/src/components/admin/geo/__tests__/NonCanonicalsPanel.test.tsx` | Non-canonicals panel tests |
| `frontend/src/components/admin/geo/__tests__/AddCoordsPanel.test.tsx` | Add coords panel tests |
| `frontend/src/components/admin/geo/__tests__/CanonicalReferenceList.test.tsx` | Canonical list tests |
| `frontend/src/components/admin/geo/__tests__/ResolveDialog.test.tsx` | Resolve dialog tests |

### Modified
| File | Change |
|------|--------|
| `api/services/geo_service.py` | Add `batch_resolve_coords`, `_check_name_ambiguity` |
| `api/routers/geo.py` | Add `POST /api/geo/batch-resolve-coords` |
| `api/schemas/geo.py` | Add `BatchResolveResponse`, update `OverrideResponse` |
| `tests/unit/api/test_geo_service.py` | Add `TestBatchResolveCoords` class |
| `frontend/src/services/geoService.ts` | Add `BatchResolveResponse`, `batchResolveCoords`, update `GeoOverride` |
| `frontend/src/hooks/useGeoData.ts` | Add `useBatchResolveCoords` mutation |
| `frontend/src/components/admin/geoConstants.ts` | Add `CATEGORY_SIDEBAR` config |
| `frontend/src/components/admin/GeoDataTab.tsx` | Re-export GeoManagementPage |

### Deleted
| File | Reason |
|------|--------|
| `frontend/src/components/admin/geo/GapsPanel.tsx` | Replaced by NonCanonicalsPanel + AddCoordsPanel |
| `frontend/src/components/admin/geo/CanonicalBrowser.tsx` | Replaced by CanonicalReferenceList |
| `frontend/src/components/admin/geo/CanonicalCard.tsx` | Absorbed into CanonicalReferenceList |
| `frontend/src/components/admin/geo/ResolveGapDialog.tsx` | Replaced by ResolveDialog |
| `frontend/src/components/admin/geo/GapsPanel.test.tsx` | Old component tests |
| `frontend/src/components/admin/geo/CanonicalBrowser.test.tsx` | Old component tests |
