/**
 * A board write-in reaches the Requests tab without a reload (kindred#2839,
 * owner report 2026-09-25).
 *
 * Staff wrote "Mini" on the board -- a typo for a filer whose nametag is
 * "Mimi" -- inside a draft scenario, then opened Requests: no "Similar name"
 * suggestion, and the Write-in dropdown did not show the new write-in until a
 * reload.
 *
 * NOT the layout harness `WeekendRosterPage.test.tsx` uses: that file holds
 * every data hook still. This one keeps the real React Query path end to end
 * -- a QueryClient carrying the app's own defaults, the page's tab-count read,
 * the Requests view kept mounted under `Activity`, and the board's real
 * `useUnitAvailability` write -- and mocks only the network, at
 * `fetchWithAuth`. The mocked server keeps the write-ins it is sent, so a
 * refetch answers with what the board wrote.
 *
 * Fictional names only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient as appQueryClient } from '../utils/queryClient'
import WeekendRosterPage from './WeekendRosterPage'

const { SESSION, SCENARIO, year } = vi.hoisted(() => ({
  SESSION: 2000001,
  SCENARIO: 'scnDRAFT000001',
  // The year the app believes it is. 0 until the backend reports it, as on a
  // cold load: `useCurrentYear` starts there.
  year: { current: 2026 },
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: year.current, setCurrentYear: vi.fn() }),
  useYear: () => year.current,
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: false,
    permissions: ['bunking.manage'],
    hasPermission: (p: string) => p === 'bunking.manage',
    hasAnyPermission: (...ps: string[]) => ps.includes('bunking.manage'),
  }),
}))

// A draft scenario of this weekend is selected, as the owner's was.
vi.mock('../hooks/useScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useScenario')>()
  const scenario = { id: SCENARIO, name: 'Option A', session_cm_id: SESSION }
  return {
    ...actual,
    useScenario: () => ({
      currentScenario: scenario,
      isProductionMode: false,
      scenarios: [scenario],
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

// Header and board furniture with their own suites and their own network; none
// of it is on the path under test.
vi.mock('../components/weekend/PushWriteInsEntry', () => ({ PushWriteInsEntry: () => null }))
vi.mock('../components/weekend/ScenarioCompareEntry', () => ({ ScenarioCompareEntry: () => null }))
vi.mock('../components/weekend/CabinWeekendEntry', () => ({ CabinWeekendEntry: () => null }))
vi.mock('../components/weekend/WeekendScenarioPicker', () => ({
  WeekendScenarioPicker: () => null,
}))
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
vi.mock('../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(() => Promise.resolve()), isMoving: false }),
}))
vi.mock('../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(() => Promise.resolve()), pendingUnitId: null }),
}))

const fetchWithAuth = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: (url: string, init?: RequestInit) => fetchWithAuth(url, init),
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

// ---------------------------------------------------------------------------
// The mocked server
// ---------------------------------------------------------------------------

interface WriteIn {
  unitId: string
  name: string
  scenario: string
}
/** What the board has written, in which scope, as the server holds it. */
let writeIns: WriteIn[] = []
/** A sessions list that fails to load. */
let sessionsFail = false

const UNIT = {
  unit_id: 'u_cedar1',
  code: 'cedar-1',
  name: 'Cedar 1',
  area_code: 'CG',
  area_name: 'Cedar Grove',
  sleeps: 4,
  bathroom: 'shared',
  bathroom_group: '',
  near_bathhouse: false,
  has_power: false,
  has_ac: false,
  has_fridge: false,
  is_accessible: false,
  is_confirmed: false,
  is_active: true,
  is_container: false,
  inventory_class: 'family_pool',
  family_available_override: null,
  reason: '',
  is_family_available: true,
  map_x: 0.5,
  map_y: 0.5,
}

const FILING = {
  submission_id: '6600000000000000101',
  session_cm_id: SESSION,
  session_name: "Women's Weekend",
  submitted_name: 'Miriam Garcia',
  nametag: 'Mimi',
  submitted_at: '2026-08-31 09:00:00',
  match_status: 'unmatched',
  suggestions: [],
}

const optionId = (w: WriteIn) => `${w.unitId}/${w.name}`

/** The scope a GET asks for: `''` is the live board. */
function scopeOf(url: string): string {
  return new URL(url, 'http://kindred.test').searchParams.get('scenario') ?? ''
}

function roster(scenario: string) {
  const mine = writeIns.filter((w) => w.scenario === scenario)
  return {
    year: 2026,
    session_cm_id: SESSION,
    session_name: "Women's Weekend",
    session_type: 'adult',
    parties: [],
    units: [
      {
        ...UNIT,
        write_ins: mine.map((w) => ({
          occupant_name: w.name,
          reason: '',
          party_size: null,
          unit_id: w.unitId,
        })),
      },
    ],
    counts: {},
  }
}

/**
 * The weekend queue: what `build_queue` would answer for the writes so far, in
 * the scope asked for -- the Write-in dropdown and suggested links offer the
 * viewed scope's write-ins alone.
 */
function weekendQueue(scenario: string) {
  const mine = writeIns.filter((w) => w.scenario === scenario)
  const options = mine.map((w) => ({
    option_id: optionId(w),
    session_cm_id: SESSION,
    unit_id: w.unitId,
    unit_name: 'Cedar 1',
    occupant_name: w.name,
  }))
  const exact = mine.find((w) => w.name === 'Mimi')
  const similar = mine.find((w) => w.name === 'Mini')
  return {
    year: 2026,
    session_cm_id: SESSION,
    scenario,
    unmatched: [{ ...FILING, write_in_suggestion: exact ? optionId(exact) : '' }],
    resolved: [],
    cancelled: [],
    write_ins: [],
    duplicates: [],
    guests: [],
    write_in_options: options,
    write_in_link_suggestions:
      similar && !exact
        ? [
            {
              option_id: optionId(similar),
              unit_id: similar.unitId,
              unit_name: 'Cedar 1',
              occupant_name: similar.name,
              submission_id: FILING.submission_id,
              filer_name: FILING.submitted_name,
              linked_in: '',
              label: `Similar name: link to ${FILING.submitted_name}'s filing?`,
              similar: true,
            },
          ]
        : [],
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function server(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/lodging/sessions')) {
    if (sessionsFail) return Promise.resolve(json({ detail: 'boom' }, 500))
    return Promise.resolve(
      json({
        year: 2026,
        sessions: [
          {
            session_id: 'sess_ww',
            session_cm_id: SESSION,
            name: "Women's Weekend",
            session_type: 'adult',
            start_date: '2026-09-11 07:00:00.000Z',
            end_date: '2026-09-13 07:00:00.000Z',
          },
        ],
      })
    )
  }
  if (url.startsWith('/api/lodging/roster')) return Promise.resolve(json(roster(scopeOf(url))))
  if (url.startsWith('/api/lodging/availability') && method === 'PUT') {
    const body = JSON.parse(String(init?.body)) as {
      unit_id: string
      occupant_name: string
      scenario: string
    }
    writeIns = [
      ...writeIns,
      { unitId: body.unit_id, name: body.occupant_name, scenario: body.scenario },
    ]
    return Promise.resolve(json({ ok: true }))
  }
  if (url.startsWith('/api/jotform/queue') && url.includes('session_cm_id=')) {
    return Promise.resolve(json(weekendQueue(scopeOf(url))))
  }
  if (url.startsWith('/api/jotform/queue')) {
    // The year's queue, for the board's "From Jotform" picker.
    return Promise.resolve(json({ ...weekendQueue(''), session_cm_id: null }))
  }
  return Promise.resolve(json({}))
}

// ---------------------------------------------------------------------------

function renderPage(client: QueryClient, view: string) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/weekend/${String(SESSION)}/${view}`]}>
        <Routes>
          <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** The app's own cache defaults (30 minute staleTime, no focus refetch), minus retries. */
function appDefaultsClient(): QueryClient {
  const defaults = appQueryClient.getDefaultOptions()
  return new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
}

async function writeInOnBoard(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('tab', { name: /housing/i }))
  await user.click(await screen.findByRole('button', { name: /cedar 1/i }))
  await user.type(await screen.findByRole('searchbox'), name)
  await user.click(screen.getByRole('button', { name: /^write in$/i }))
}

beforeEach(() => {
  year.current = 2026
  sessionsFail = false
  writeIns = []
  fetchWithAuth.mockReset()
  fetchWithAuth.mockImplementation(server)
})

describe('WeekendRosterPage — a board write-in reaches the Requests tab', () => {
  it('shows the new write-in, its similar-name suggestion and the new pre-selection without a reload', async () => {
    const user = userEvent.setup()
    renderPage(appDefaultsClient(), 'requests')

    // Requests is opened first, so it is the view `Activity` keeps mounted.
    const row = await screen.findByTestId(`jotform-unmatched-${FILING.submission_id}`)
    expect(within(row).queryByLabelText(/write-in for/i)).not.toBeInTheDocument()

    // The typo, written on the board.
    await writeInOnBoard(user, 'Mini')
    await waitFor(() => {
      // Written into the draft scenario the page is showing, not the live board.
      expect(writeIns).toEqual([{ unitId: 'u_cedar1', name: 'Mini', scenario: SCENARIO }])
    })

    await user.click(screen.getByRole('tab', { name: /requests/i }))
    const panel = screen.getByRole('tabpanel', { name: /requests/i })
    // The dropdown offers it, and the similar-name suggestion is shown.
    const select = await within(panel).findByLabelText('Write-in for Miriam Garcia')
    expect(within(select).getByRole('option', { name: 'Mini · Cedar 1' })).toBeInTheDocument()
    expect(
      await within(panel).findByText('Similar name: write-in Mini · Cedar 1')
    ).toBeInTheDocument()

    // Then the right spelling: the exact match is pre-selected.
    await writeInOnBoard(user, 'Mimi')
    await waitFor(() => {
      expect(writeIns).toHaveLength(2)
    })
    await user.click(screen.getByRole('tab', { name: /requests/i }))
    await waitFor(() => {
      expect(
        within(
          screen.getByRole('tabpanel', { name: /requests/i })
        ).getByLabelText<HTMLSelectElement>('Write-in for Miriam Garcia').value
      ).toBe('u_cedar1/Mimi')
    })
  })

  it('shows the write-in on a Requests tab first opened after the write', async () => {
    const user = userEvent.setup()
    renderPage(appDefaultsClient(), 'housing')

    await writeInOnBoard(user, 'Mini')
    await waitFor(() => {
      expect(writeIns).toHaveLength(1)
    })

    await user.click(screen.getByRole('tab', { name: /requests/i }))
    const panel = screen.getByRole('tabpanel', { name: /requests/i })
    expect(
      await within(panel).findByText('Similar name: write-in Mini · Cedar 1')
    ).toBeInTheDocument()
  })
})

describe('WeekendRosterPage — a cold hard refresh on /requests (scan of #2839)', () => {
  // On a real cold load the year is 0 until the backend reports it, so the
  // sessions query is DISABLED -- `isLoading` false with no data. Read as
  // "loaded", that refused `requests` and seeded the page on Housing, mounting
  // the board for nothing on the way to the tab the URL named.
  function page(client: QueryClient) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/weekend/${String(SESSION)}/requests`]}>
          <Routes>
            <Route path="/weekend/:sessionRef/:view?" element={<WeekendRosterPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  const housingPanelChildren = () =>
    document.getElementById('weekend-panel-housing')?.childElementCount ?? 0

  it('waits through year 0 for the weekend, and never opens Housing on the way', async () => {
    year.current = 0
    const client = appDefaultsClient()
    const { rerender } = render(page(client))

    year.current = 2026
    rerender(page(client))

    const tab = await screen.findByRole('tab', { name: /requests/i })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByTestId(`jotform-unmatched-${FILING.submission_id}`)
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /housing/i })).toHaveAttribute('aria-selected', 'false')
    expect(housingPanelChildren()).toBe(0)
  })

  it('does not call the weekend unknown while the year is still 0', () => {
    year.current = 0
    render(page(appDefaultsClient()))
    expect(screen.queryByRole('button', { name: /Weekend not found/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Loading weekends/ })).toBeInTheDocument()
  })

  it('falls back to Housing when the weekend list fails, rather than waiting forever', async () => {
    sessionsFail = true
    year.current = 0
    const client = appDefaultsClient()
    const { rerender } = render(page(client))

    year.current = 2026
    rerender(page(client))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /housing/i })).toHaveAttribute('aria-selected', 'true')
    })
  })
})
