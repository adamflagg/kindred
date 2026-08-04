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

import { LodgingApiError } from '../services/lodgingApi'
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

const copyPlacementsFromMirror = vi.fn()

vi.mock('../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/lodgingApi')>()
  return {
    ...actual,
    copyPlacementsFromMirror: (...args: unknown[]) => copyPlacementsFromMirror(...args),
  }
})

const invalidateQueries = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) }
})

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
  copyPlacementsFromMirror.mockReset().mockResolvedValue({ copied: 47, skipped: 0 })
  invalidateQueries.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
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

describe('seeding an empty scenario', () => {
  it('offers a way out of an empty board', () => {
    // #1974 made a scenario REPLACE the mirror, so a fresh one renders
    // nothing — all 62 families gone. That reads as a bug, not as a blank
    // plan, and staff need an obvious way to fill it.
    currentScenario = OPTION_A
    renderPage()
    expect(screen.getByRole('button', { name: /start from campminder/i })).toBeInTheDocument()
  })

  it('does NOT offer it in mirror mode, where there is nothing to seed into', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /start from campminder/i })).not.toBeInTheDocument()
  })

  it('does NOT offer it once the scenario holds placements', () => {
    currentScenario = OPTION_A
    rosterQuery.data = { ...emptyPlan(), counts: { parties_total: 62, parties_assigned: 47 } }
    renderPage()
    expect(screen.queryByRole('button', { name: /start from campminder/i })).not.toBeInTheDocument()
  })

  it('does NOT offer it on a weekend with no families at all', () => {
    // An empty board is CORRECT here, and seeding would copy nothing.
    currentScenario = OPTION_A
    rosterQuery.data = { ...emptyPlan(), counts: { parties_total: 0, parties_assigned: 0 } }
    renderPage()
    expect(screen.queryByRole('button', { name: /start from campminder/i })).not.toBeInTheDocument()
  })

  it('is hidden from a user without bunking.manage', () => {
    permissions = new Set()
    currentScenario = OPTION_A
    renderPage()
    expect(screen.queryByRole('button', { name: /start from campminder/i })).not.toBeInTheDocument()
  })

  it('sends the weekend and the scenario', async () => {
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() => {
      expect(copyPlacementsFromMirror).toHaveBeenCalledWith(expect.anything(), {
        year: 2026,
        sessionCmId: 1000001,
        scenario: 'scn7x2k9qw3mnbv',
      })
    })
  })

  it('INVALIDATES the roster afterwards, because nothing refreshes on its own', async () => {
    // These queries carry the app default 30 minute staleTime. Without an
    // explicit invalidation the seed writes 47 rows and the board keeps
    // showing the empty plan for half an hour.
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() => {
      const keys = invalidateQueries.mock.calls.map(
        ([arg]) => (arg as { queryKey: readonly unknown[] }).queryKey
      )
      expect(keys).toContainEqual(['weekend-roster', 2026, 1000001, 'scn7x2k9qw3mnbv'])
      expect(keys).toContainEqual(['weekend-summary', 2026])
    })
  })

  it('reports what it wrote', async () => {
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/47/)))
  })

  it('surfaces skipped rows rather than silently showing fewer families', async () => {
    // `skipped` means mirror rows naming a party or a unit that no longer
    // resolves. Unreported, the only evidence is a board with fewer families
    // on it than CampMinder shows.
    copyPlacementsFromMirror.mockResolvedValue({ copied: 45, skipped: 2 })
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/2/)))
  })

  it('treats a 409 as ALREADY SEEDED, not as a failure', async () => {
    // The server refuses a second copy because it would overwrite what staff
    // placed and re-place everything they unplaced. That refusal protects
    // them; reporting it as an error teaches them to distrust the button.
    // The REAL error class, not an Object.assign stand-in — a synthetic
    // fixture would keep passing if `toError` stopped attaching the status.
    copyPlacementsFromMirror.mockRejectedValue(
      new LodgingApiError('Scenario already holds placements', 409)
    )
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/already/i))
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('still reports a real failure as a failure', async () => {
    copyPlacementsFromMirror.mockRejectedValue(
      new LodgingApiError('Permission required: bunking.manage', 403)
    )
    currentScenario = OPTION_A
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /start from campminder/i }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/bunking\.manage/))
    )
  })
})

describe('creating a weekend plan', () => {
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

  it('offers the mirror seed AT CREATION, where summer puts it', async () => {
    renderPage()
    await openCreateModal()

    expect(screen.getByLabelText(/Copy placements from CampMinder/i)).toBeInTheDocument()
  })

  it('does NOT offer the inert copy-from-another-scenario radios', async () => {
    // `Option A` is in the picker's list, so before this these rendered —
    // mapping to `{ fromScenario }`, the same `POST /api/scenarios` path that
    // copies `bunk_assignments` and returns zero rows for a weekend. Exactly
    // the defect already fixed for the production radio, arriving by the same
    // route. Copying a weekend plan needs a source field the API lacks (#1988).
    renderPage()
    await openCreateModal()

    expect(screen.queryByText(/Copy from scenario/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Option A$/)).not.toBeInTheDocument()
  })

  it('creates the plan, then seeds THE NEW ONE from the mirror', async () => {
    // Two calls, and the second must name the scenario the first returned.
    // Seeding the previously-selected scenario instead would fill a plan the
    // staff member is not looking at — and 409 doing it.
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy placements from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => {
      expect(copyPlacementsFromMirror).toHaveBeenCalledWith(expect.anything(), {
        year: 2026,
        sessionCmId: 1000001,
        scenario: 'scnNEW00000000',
      })
    })
  })

  it('does NOT seed when the empty plan was chosen', async () => {
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Start with an empty plan/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => expect(createScenario).toHaveBeenCalled())
    expect(copyPlacementsFromMirror).not.toHaveBeenCalled()
  })

  it('tells staff when the plan was created but the seed failed', async () => {
    // The scenario EXISTS at this point. Closing quietly would leave them on
    // an empty board believing the copy ran. The way back is
    // `SeedScenarioNotice`, which still renders for exactly this state — see
    // "offers a way out of an empty board" above.
    copyPlacementsFromMirror.mockRejectedValue(new LodgingApiError('PocketBase unreachable', 502))
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy placements from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => expect(screen.getByText(/PocketBase unreachable/i)).toBeInTheDocument())
  })

  it('reports the seeded count on the happy path', async () => {
    renderPage()
    await openCreateModal()
    await userEvent.click(screen.getByLabelText(/Copy placements from CampMinder/i))
    await userEvent.type(screen.getByLabelText(/Scenario Name/i), 'Option B')
    await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/47/)))
  })
})
