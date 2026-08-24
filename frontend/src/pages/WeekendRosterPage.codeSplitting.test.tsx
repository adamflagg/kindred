/**
 * The lodging board and map ship in their own chunks, not the roster route's
 * initial one (#1964) — both are lazy-loaded behind a Suspense boundary, so
 * a visit that never leaves the Housing tab (most of them) never pays for
 * the map's clustering/viewport code, and a visit that never opens Map never
 * pays for the board's drag/merge code either.
 *
 * Kept in its OWN file, rather than folded into `WeekendRosterPage.test.tsx`,
 * because `React.lazy` caches its resolved module on the LAZY OBJECT itself
 * — at `WeekendRosterPage.tsx`'s module scope, shared by every test in a
 * file. Once ANY test mounts a view, every LATER test in that same file
 * sees the chunk pre-resolved and paints synchronously, same as a real
 * browser reusing an already-fetched chunk. Proving the split is real needs
 * each component's FIRST-EVER render in its file to be pristine, so this
 * file holds nothing else: one test per component, one render each.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WeekendRosterPage from './WeekendRosterPage'

const sessionsQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const rosterQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => sessionsQuery,
  useWeekendRoster: () => rosterQuery,
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

// The Groups tab (kindred#1913) is a real React Query hook, and these page
// tests deliberately render without a QueryClientProvider — every other data
// hook here is mocked for the same reason. The tab strip reads only the count.
vi.mock('../hooks/useWeekendFriendGroups', () => ({
  useWeekendFriendGroups: () => ({ data: { groups: [] }, isLoading: false, error: null }),
  useFriendGroupMutations: () => ({
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    updateGroupAsync: vi.fn().mockResolvedValue({}),
    deleteGroup: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
  useYear: () => 2026,
}))

vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

// New since kindred#2538: WeekendScenarioPicker now keeps
// ScenarioManagementModal MOUNTED so its close can play an exit fade, and that
// modal calls `useSyncStatusAPI`, which calls `useAuth`. The dialog's query is
// gated on `isOpen`, but the hook itself runs at the permanent mount. The real
// app always has the provider (App.tsx wraps everything in AuthProvider); this
// file's convention, like WeekendRosterPage.test.tsx's, is to stub the
// auth-touching hooks rather than mount one.
vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: undefined }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }
})

// The board mounts `useLodgingPlacement`, which mounts a real `useMutation` —
// and that reaches for a QueryClient through react-query's own internals,
// which the `useQueryClient` stub above does not satisfy. Drag placement has
// its own tests in `components/weekend/LodgingBoard.drag.test.tsx`.
vi.mock('../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(() => Promise.resolve()), isMoving: false }),
}))

// Same reason, same board: the reserve/release control mounts a real
// `useMutation` too. Its gate is pinned in
// `components/weekend/LodgingBoard.availability.test.tsx`.
vi.mock('../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({
    setAvailability: vi.fn(() => Promise.resolve()),
    pendingUnitId: '',
  }),
}))

// Same reason, same board: the merge handle and split control mount a real
// `useMutation` too. Their gate is pinned in
// `components/weekend/LodgingBoard.merge.test.tsx`.
vi.mock('../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({
    setCombined: vi.fn(() => Promise.resolve()),
    pendingUnitId: null,
  }),
}))

vi.mock('../hooks/useScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useScenario')>()
  return {
    ...actual,
    useScenario: () => ({
      currentScenario: null,
      isProductionMode: true,
      scenarios: [],
      isLoading: false,
      isMutating: false,
      error: null,
      loadScenarios: vi.fn(),
      createScenario: vi.fn(),
      selectScenario: vi.fn(),
      updateScenario: vi.fn(),
      deleteScenario: vi.fn(),
      clearScenario: vi.fn(),
    }),
  }
})

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

const FAMILY_CAMP_1 = {
  session_id: 'sess_1',
  session_cm_id: 1000001,
  name: 'Family Camp 1: Memorial Day Weekend',
  session_type: 'family',
  start_date: '2026-05-22 07:00:00.000Z',
  end_date: '2026-05-25 07:00:00.000Z',
}

const ONE_UNIT = {
  year: 2026,
  session_cm_id: 1000001,
  parties: [],
  counts: {},
  units: [
    {
      unit_id: 'u1',
      code: 'ridge-a',
      name: 'Ridge A',
      area_code: 'RIDGE',
      area_name: 'Ridge Side',
      sleeps: 5,
      is_confirmed: true,
      is_container: false,
      is_family_available: true,
    },
  ],
}

function renderPage(view: string) {
  return render(
    <MemoryRouter initialEntries={[`/weekend/1000001/${view}`]}>
      <Routes>
        <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  sessionsQuery.data = { year: 2026, sessions: [FAMILY_CAMP_1] }
  sessionsQuery.isLoading = false
  sessionsQuery.error = null
  rosterQuery.data = ONE_UNIT
  rosterQuery.isLoading = false
  rosterQuery.error = null
})

describe('code splitting (#1964)', () => {
  // ORDER AND EXCLUSIVITY MATTER — see the file header. Each test here must
  // be the only one to mount its view, or the synchronous half proves
  // nothing (a second mount in the same file always paints immediately,
  // lazy or not, because the chunk is already resolved).

  it('paints a fallback for the housing board first, then the board once its chunk resolves', async () => {
    renderPage('housing')
    // SYNCHRONOUS check — no `await` before this line. An eager import
    // would already have 'Ridge A' painted in the same tick as `render()`;
    // a lazy one has only started the dynamic import and is still waiting
    // on its microtask to settle.
    expect(screen.queryByText('Ridge A')).not.toBeInTheDocument()

    // EXACTLY one fallback, not "at least one" (`getAllByTestId`, not
    // `getByTestId` — #2059 review) — this is what pins #2059's `openedViews`
    // gate on `Activity`. Map was never opened here, but `Activity`'s hidden
    // mode still mounts hidden content — so an UNGATED `Activity` around all
    // three panels would start Map's dynamic import on this SAME render too,
    // and Map's chunk is just as fresh as the board's here, so it shows ITS
    // OWN loading fallback rather than resolved content. A `map-canvas`-
    // absence check alone can't tell that apart from the correctly-gated
    // case (both are simply "not there yet"); the COUNT can, and it does so
    // whether this test runs as part of the whole file or isolated via `-t`
    // — either way this is Housing's (and, if ungated, Map's) first-ever
    // render in this file.
    expect(screen.getAllByTestId('lodging-view-loading')).toHaveLength(1)
    // Map was never opened at all — kept alongside the count above as a
    // second, independent signal for the same gate.
    expect(screen.queryByTestId('map-canvas')).not.toBeInTheDocument()

    // Explicit timeout, well above `findBy`'s 1000ms default (kindred#2553).
    // This line waits on a REAL dynamic `import()` — the whole point of the
    // test — so vitest must transform and evaluate the board's module graph
    // before 'Ridge A' can paint. Measured: 369ms on an idle box, but 2536ms
    // and 3059ms with all 12 cores saturated, which is what a full-suite run
    // looks like. The default budget made this a load-sensitive flake. The
    // assertion is unchanged: the fallback checks above are what pin the
    // lazy + gated behaviour, and this one only pins that the chunk DOES
    // arrive — so waiting longer for it weakens nothing.
    expect(await screen.findByText('Ridge A', undefined, { timeout: 10000 })).toBeInTheDocument()
  }, 15000)

  it('paints a fallback for the map first, then the map once its chunk resolves', async () => {
    renderPage('map')
    expect(screen.queryByTestId('map-canvas')).not.toBeInTheDocument()
    expect(screen.getByTestId('lodging-view-loading')).toBeInTheDocument()

    // Same real-`import()` wait as the housing test above (kindred#2553).
    expect(
      await screen.findByTestId('map-canvas', undefined, { timeout: 10000 })
    ).toBeInTheDocument()
  }, 15000)
})
