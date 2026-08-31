/**
 * The weekend scenario picker (#1967).
 *
 * Every lodging write requires a scenario — `scenario: str = Field(...,
 * min_length=1)` — and no weekend surface selected one, so the board could
 * not call a write endpoint even once drag existed.
 *
 * Kept separate from `WeekendRosterPage.test.tsx` because that file's mocks
 * deliberately hold the roster hook still to test layout, while these tests
 * need to watch what the page ASKS it for. Same precedent as
 * `BunkingBoardByArea.prod.test.tsx`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WeekendRosterPage from './WeekendRosterPage'

const rosterQuery = { data: undefined as unknown, isLoading: false, error: null as Error | null }
const useWeekendRosterSpy = vi.fn()

vi.mock('../hooks/useWeekendRoster', () => ({
  useWeekendSessions: () => ({
    data: {
      year: 2026,
      sessions: [
        {
          session_id: 'sess_1',
          session_cm_id: 1000001,
          name: 'Family Camp 1: Memorial Day Weekend',
          session_type: 'family',
          start_date: '2026-05-22 07:00:00.000Z',
          end_date: '2026-05-25 07:00:00.000Z',
        },
      ],
    },
    isLoading: false,
    error: null,
  }),
  useWeekendRoster: (...args: unknown[]) => {
    useWeekendRosterSpy(...args)
    return rosterQuery
  },
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

let permissions = new Set<string>()

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: false,
    permissions: [...permissions],
    hasPermission: (p: string) => permissions.has(p),
    hasAnyPermission: (...ps: string[]) => ps.some((p) => permissions.has(p)),
  }),
}))

// The global ScenarioContext, stubbed. Reusing it is safe — `currentSessionId`
// is a single slot but selection persists per session id, so weekend and
// summer do not contaminate each other's choice.
const OPTION_A = { id: 'scn7x2k9qw3mnbv', name: 'Option A', session_cm_id: 1000001 }
const NEW_PLAN = { id: 'scnNEW00000000', name: 'Option B', session_cm_id: 1000001, is_active: true }
let currentScenario: typeof OPTION_A | null = null
const loadScenarios = vi.fn()
const selectScenario = vi.fn()
const createScenario = vi.fn()

vi.mock('../hooks/useScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useScenario')>()
  return {
    ...actual,
    useScenario: () => ({
      currentScenario,
      isProductionMode: currentScenario === null,
      scenarios: [OPTION_A],
      isLoading: false,
      isMutating: false,
      error: null,
      loadScenarios,
      createScenario: (...args: unknown[]) => createScenario(...args),
      selectScenario,
      updateScenario: vi.fn(),
      deleteScenario: vi.fn(),
      clearScenario: vi.fn(),
    }),
  }
})

// Summer's management modal, reused unchanged — it reaches the network on
// mount. Stubbed to a marker because what these tests own is whether the gear
// opens it and which session it names, not what it does once open.
vi.mock('../components/ScenarioManagementModal', () => ({
  default: ({ sessionId }: { sessionId: number }) => (
    <div data-testid="scenario-management-modal">managing {sessionId}</div>
  ),
}))

const fetchWithAuth = vi.fn()

vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) }
})

// The push entry (kindred#2477) mounts `PushWriteInsModal`, whose preview
// `useQuery` reaches for a real QueryClient the moment a scenario is selected
// — the exact tests below. Same policy as every hook mock in this file: these
// are layout/navigation tests, and the entry has its own dedicated suite in
// `components/weekend/PushWriteInsEntry.test.tsx`.
vi.mock('../components/weekend/PushWriteInsEntry', () => ({
  PushWriteInsEntry: () => null,
}))

// Same reasoning, and the same shape, for the compare entry (kindred#2478
// §5): it mounts `ScenarioCompareModal`, which reads `useSyncStatusAPI` for
// the mirror's age and so needs a real AuthProvider these layout tests do not
// stand up. Its own suite is `components/weekend/ScenarioCompareEntry.test.tsx`.
vi.mock('../components/weekend/ScenarioCompareEntry', () => ({
  ScenarioCompareEntry: () => null,
}))

// Same reasoning again, for the cabin-weekend chip (kindred#2648 UI half):
// `CabinWeekendEntry` mounts `useSessionAttributionQueue`, a real
// `useQuery`/`useMutation` the `useQueryClient` stub above does not satisfy.
// Its own suite is `components/weekend/CabinWeekendEntry.test.tsx`.
vi.mock('../components/weekend/CabinWeekendEntry', () => ({
  CabinWeekendEntry: () => null,
}))

// The board mounts `useLodgingPlacement`, which mounts a real `useMutation` —
// and that reaches for a QueryClient through react-query's own internals,
// which the `useQueryClient` stub above does not satisfy. These files are
// about layout, navigation and the scenario picker; drag placement has its own
// tests in `components/weekend/LodgingBoard.drag.test.tsx`.
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

const toastSuccess = vi.fn()
const toastError = vi.fn()

// Indirected through arrows: `vi.mock` is hoisted above the consts above, so
// a factory that reads them eagerly throws on initialisation.
vi.mock('react-hot-toast', () => {
  const stub = {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  }
  return { default: stub, toast: stub }
})

/** A roster with parties present and none of them placed. */
function emptyPlan() {
  return {
    year: 2026,
    session_cm_id: 1000001,
    parties: [],
    units: [],
    counts: { parties_total: 62, parties_assigned: 0, parties_unassigned: 62 },
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/weekend/1000001/housing']}>
      <Routes>
        <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  permissions = new Set(['bunking.manage'])
  currentScenario = null
  rosterQuery.data = emptyPlan()
  rosterQuery.isLoading = false
  rosterQuery.error = null
  useWeekendRosterSpy.mockReset()
  loadScenarios.mockReset()
  selectScenario.mockReset()
  createScenario.mockReset().mockResolvedValue(NEW_PLAN)
  invalidateQueries.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('tabs', () => {
  it('offers Housing, Roster, Groups and Map, and no Inventory tab', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: /Housing/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Roster/ })).toBeInTheDocument()
    // kindred#1913: friend groups are a tab, not a modal, so the URL carries
    // them and a group can be linked to.
    expect(screen.getByRole('tab', { name: /Groups/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Map/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Inventory/ })).not.toBeInTheDocument()
  })
})

describe('the picker', () => {
  it('registers THIS weekend with the scenario context', () => {
    // `useSavedScenarios` filters by `currentSessionId`. Left unset, the
    // picker would offer whatever session summer last looked at.
    renderPage()
    expect(loadScenarios).toHaveBeenCalledWith(1000001)
  })

  it('is hidden from a user without bunking.manage', () => {
    permissions = new Set()
    renderPage()
    expect(screen.queryByRole('button', { name: /^scenario$/i })).not.toBeInTheDocument()
  })

  it('is offered to a NON-ADMIN holding bunking.manage', () => {
    // The lodging write rules gate on bunking.manage, not on the admin flag.
    renderPage()
    expect(screen.getByRole('button', { name: /^scenario$/i })).toBeInTheDocument()
  })

  it('offers the manage-scenarios gear beside the picker, as summer does', () => {
    // Summer's SessionHeader puts a gear next to the scenario dropdown that
    // opens rename/delete. Without it a weekend can create plans and never
    // tidy them up.
    renderPage()
    expect(screen.getByRole('button', { name: /manage scenarios/i })).toBeInTheDocument()
  })

  it('gates the gear on bunking.manage too', () => {
    // It opens a RENAME/DELETE surface. Gating the picker but not the gear
    // would hand a viewer the destructive half of the pair.
    permissions = new Set()
    renderPage()
    expect(screen.queryByRole('button', { name: /manage scenarios/i })).not.toBeInTheDocument()
  })

  it('opens the management modal on THIS weekend from the gear', async () => {
    // Naming the session matters: scenarios are per-session, and handing the
    // modal the wrong id would list summer's plans under a weekend.
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /manage scenarios/i }))
    expect(await screen.findByTestId('scenario-management-modal')).toHaveTextContent(
      'managing 1000001'
    )
  })
})

describe('what the roster is asked for', () => {
  it('asks for the mirror when no scenario is selected', () => {
    renderPage()
    expect(useWeekendRosterSpy).toHaveBeenCalledWith(2026, 1000001, '')
  })

  it('asks for the DRAFT once a scenario is selected', () => {
    // The load-bearing wire. Without it the page renders the mirror while the
    // badge says Draft, and every write would target a plan nobody is looking
    // at.
    currentScenario = OPTION_A
    renderPage()
    expect(useWeekendRosterSpy).toHaveBeenCalledWith(2026, 1000001, 'scn7x2k9qw3mnbv')
  })

  it('does not pass a scenario belonging to a DIFFERENT weekend', () => {
    // ScenarioContext holds one selection globally. On a direct load of a
    // second weekend the previous weekend's scenario survives for a render,
    // and reading the roster with it would 404 or, worse, resolve.
    currentScenario = { ...OPTION_A, session_cm_id: 1000002 }
    renderPage()
    expect(useWeekendRosterSpy).toHaveBeenCalledWith(2026, 1000001, '')
  })
})

describe('the mode badge', () => {
  it('says CampMinder mirror when no scenario is selected', () => {
    renderPage()
    expect(screen.getByLabelText(/Viewing CampMinder data/i)).toBeInTheDocument()
  })

  it('still tells a VIEWER which data they are looking at', () => {
    // The badge renders for everyone; only the picker is gated. That split is
    // asserted here because it is the kind of thing a later "gate the whole
    // picker component" change would silently undo — leaving a viewer with no
    // way to know whether the placements on screen are CampMinder's.
    permissions = new Set()
    renderPage()
    expect(screen.getByLabelText(/Viewing CampMinder data/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^scenario$/i })).not.toBeInTheDocument()
  })

  it('says Draft, naming the scenario, once one is selected', () => {
    // The board and map hardcode an amber "CM — CampMinder mirror, read-only"
    // chip. Left hardcoded it would claim the mirror while showing a draft.
    currentScenario = OPTION_A
    renderPage()
    expect(screen.getByLabelText(/Draft mode: Option A/i)).toBeInTheDocument()
    expect(screen.queryByText(/CampMinder mirror, read-only/i)).not.toBeInTheDocument()
  })
})

describe('creating a weekend plan', () => {
  // kindred#2021: creation and its copy are now ONE call — `POST
  // /api/scenarios` is program-aware server-side (LodgingWriteService reads
  // lodging_assignments / lodging_assignments_draft for a weekend session,
  // exactly as summer's copy reads bunk_assignments(_draft)). There is no
  // longer a second "seed" round trip for these tests to watch: the mock
  // `createScenario` (from `useScenario`) stands in for the whole backend
  // call, so what matters here is which `copyOptions` it receives.

  async function openCreateModal() {
    await userEvent.click(screen.getByRole('button', { name: /^scenario$/i }))
    await userEvent.click(screen.getByRole('option', { name: /New Scenario/i }))
  }

  it('names what it starts empty in the WEEKEND’s vocabulary', async () => {
    // A weekend has no bunks. It places parties into cabins and rooms, and
    // "parties" is already its own word — the lander and the stats bar both
    // count them. CLAUDE.md §4 asks for summer's PATTERN, and lifting its
    // literal noun is the failure that rule exists to catch.
    renderPage()
    await openCreateModal()

    expect(screen.getByLabelText(/Start with an empty plan/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/empty bunks/i)).not.toBeInTheDocument()
  })

  it('offers copy from CampMinder, exactly as summer does', async () => {
    renderPage()
    await openCreateModal()

    expect(screen.getByLabelText(/Copy from CampMinder/i)).toBeInTheDocument()
  })

  it('offers copy from another scenario too, now that the backend copy works for a weekend', async () => {
    // Before kindred#2021 these radios were hidden: they mapped to
    // `{ fromScenario }`, the same `POST /api/scenarios` path that copied
    // bunk_assignments and returned zero rows for a weekend. The backend is
    // program-aware now, so hiding them would be withholding a working
    // choice, not avoiding a broken one — and the owner's requirement is
    // that all three choices work, identically, for both programs.
    renderPage()
    await openCreateModal()

    expect(screen.getByText(/Copy from scenario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Option A$/)).toBeInTheDocument()
  })

  it('sends { fromProduction: true } when Copy from CampMinder is chosen', async () => {
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => {
      expect(createScenario).toHaveBeenCalledWith('Option B', 1000001, 2026, undefined, {
        fromProduction: true,
      })
    })
  })

  it('sends { fromScenario: id } when copy from another scenario is chosen', async () => {
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/^Option A$/))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => {
      expect(createScenario).toHaveBeenCalledWith('Option B', 1000001, 2026, undefined, {
        fromScenario: 'scn7x2k9qw3mnbv',
      })
    })
  })

  it('sends { fromProduction: false } when the empty plan was chosen', async () => {
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Start with an empty plan/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => {
      expect(createScenario).toHaveBeenCalledWith('Option B', 1000001, 2026, undefined, {
        fromProduction: false,
      })
    })
  })

  it('tells staff when creation (copy included) failed', async () => {
    // The create-and-copy is now one call, so a failure here means the
    // scenario was never created either — unlike the old two-step flow,
    // there is no "created but empty" state left to recover from. The
    // modal shows the failure in its own error box rather than closing.
    createScenario.mockRejectedValue(new Error('PocketBase unreachable'))
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => expect(screen.getByText(/PocketBase unreachable/i)).toBeInTheDocument())
  })

  it('reports success with the new scenario name, matching summer’s own create flow', async () => {
    // SessionView.tsx's own "+ New Scenario" flow toasts
    // `Created scenario: ${scenario.name}`; this is the weekend analogue.
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Created scenario: Option B/))
    )
  })

  it('surfaces a nonzero copy_skipped instead of silently showing fewer families', async () => {
    // copy_skipped names a mirror/source row whose party or unit no longer
    // resolves. Unreported, the only evidence would be a board with fewer
    // families than the source shows.
    createScenario.mockResolvedValue({ ...NEW_PLAN, copy_skipped: 2 })
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Skipped 2/))
    )
  })
})
