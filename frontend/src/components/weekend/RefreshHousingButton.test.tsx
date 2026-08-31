/**
 * `Refresh Housing` — kindred#2478 §4, all four ruled states.
 *
 * The load-bearing test in this file is "the board actually shows the refreshed
 * placements". Weekend queries carry the app default 30 minute `staleTime`
 * (`utils/queryClient.ts`), so a cutover that does not EXPLICITLY invalidate
 * leaves the board on pre-refresh placements for half an hour under a toast
 * saying it refreshed — §4.3: "strictly worse than not shipping the feature."
 * That test therefore drives a REAL QueryClient with the real defaults and a
 * REAL mounted roster query, and asserts the rendered value changes.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { SyncStatusResponse } from '../../hooks/useSyncStatusAPI'
import { queryKeys } from '../../utils/queryKeys'

/**
 * A REAL `useQuery` on the real `['sync-status']` key, not a hand-fed hook
 * return. `useSyncSequenceRun.start()` takes its baseline from the reading
 * `invalidateQueries()`' own promise waits for (kindred#2599), so a mock that
 * never reaches the cache leaves a PRESS with no baseline at all — this file
 * used to synthesise an advancing `dataUpdatedAt` by hand for the same reason,
 * and no longer has to model the query layer at all.
 */
vi.mock('../../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts?: { enabled?: boolean }) =>
    useQuery({
      queryKey: queryKeys.syncStatus(),
      queryFn: () => Promise.resolve(currentStatus),
      enabled: opts?.enabled ?? true,
    }),
}))

const refreshFamilyCamp = vi.fn((..._args: unknown[]) => Promise.resolve({ status: 'started' }))
vi.mock('../../services/sync', () => ({
  syncService: { refreshFamilyCamp: (...a: unknown[]) => refreshFamilyCamp(...a) },
}))

// A STABLE sentinel, not a fresh `vi.fn()` per call: the auth-contract test
// below asserts the component hands THIS function to the service, which is what
// proves `/refresh-family-camp` goes out authenticated. A new mock per call
// would make that identity check unwritable.
const fetchWithAuth = vi.fn()
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth, isAuthenticated: true, isAuthLoading: false }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}))

import { RefreshHousingButton } from './RefreshHousingButton'

const BASELINE_END = '2026-04-22T09:13:08.000Z'

function status(overrides: Record<string, unknown> = {}): SyncStatusResponse {
  return {
    attendees: { status: 'success', end_time: '2026-04-22T09:00:00.000Z' },
    persons: { status: 'success', end_time: '2026-04-22T09:00:20.000Z' },
    person_custom_values_family_camp: { status: 'success', end_time: '2026-04-22T09:09:00.000Z' },
    household_custom_values_family_camp: {
      status: 'success',
      end_time: '2026-04-22T09:13:00.000Z',
    },
    family_camp_derived: { status: 'success', end_time: '2026-04-22T09:13:06.000Z' },
    lodging_assignments: { status: 'success', end_time: BASELINE_END },
    ...overrides,
  } as unknown as SyncStatusResponse
}

/** What `GET /api/custom/sync/status` would answer right now. */
let currentStatus: SyncStatusResponse = status()
function setStatus(s: SyncStatusResponse) {
  currentStatus = s
}

/** The app's real cache policy — 30 minutes stale, no refetch on focus. */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  })
}

/** What the weekend board renders. Its key is a real `weekendRoster` key. */
let rosterFromServer = 'Tamarack 1'
function RosterProbe() {
  const { data } = useQuery({
    queryKey: queryKeys.weekendRoster(2026, 900, ''),
    queryFn: () => Promise.resolve(rosterFromServer),
  })
  return <div data-testid="roster">{data ?? 'loading'}</div>
}

/**
 * The weekend the shell is pointed at. `AppLayout` only renders this button
 * once `useWeekendShellSession` has resolved one, so a session is always in
 * hand — there is no unscoped state to model here (kindred#2601).
 */
/**
 * Name length is DELIBERATE. Real weekend names reach 50 characters, which makes
 * the modal title ~70 in a `size="sm"` dialog — a short fixture cannot exercise
 * that geometry, and the first draft of this file used one.
 */
const TEST_SESSION = {
  session_cm_id: 900,
  name: 'Family Camp 5: Extended Program Weekend (all ages)',
}

function renderButton(client = makeClient(), session = TEST_SESSION) {
  // A WARM cache and no polling — the state a page at rest is in, and the one
  // kindred#2595 is about. Seeding it also keeps the first render synchronous.
  client.setQueryData(queryKeys.syncStatus(), currentStatus)
  const utils = render(
    <QueryClientProvider client={client}>
      <RosterProbe />
      <RefreshHousingButton session={session} />
    </QueryClientProvider>
  )
  return { ...utils, client }
}

/** One 3 s poll landing, through the real cache. */
async function poll(client: QueryClient, s: SyncStatusResponse) {
  currentStatus = s
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.syncStatus() })
  })
}

/**
 * Settle the press: `start()` cancels any in-flight poll, invalidates, and
 * awaits that refetch before it has a baseline to measure the run against.
 */
async function settlePress() {
  await act(async () => {})
}

describe('RefreshHousingButton — resting and the press modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFromServer = 'Tamarack 1'
    setStatus(status())
  })

  it('renders the Refresh Housing action', () => {
    renderButton()
    expect(screen.getByRole('button', { name: /Refresh Housing/i })).toBeInTheDocument()
  })

  it('opens a modal on press rather than starting the refresh', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(refreshFamilyCamp).not.toHaveBeenCalled()
  })

  it('states the cost, the staleness and the last refresh — the only place the cost is said', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/2–4 minutes/)
    expect(dialog.textContent).toMatch(/won't show here yet/i)
    expect(dialog.textContent).toMatch(/ago/)
  })

  it('says what happens next in staff language, not board language', () => {
    // Owner review: "the board keeps showing the current plan until it lands"
    // is our vocabulary, not theirs. What staff need to know is that walking
    // away is safe and that the screen updates itself — this dialog is the
    // press half of a press-and-walk-away flow (kindred#2478 §4.2).
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/keep working/i)
    expect(dialog.textContent).toMatch(/refresh(es)? itself|automatically/i)
    expect(dialog.textContent).not.toMatch(/current plan/i)
  })

  it('separates the body from the footer buttons', () => {
    // Owner review: the last line ran straight into `Not now` / `Start
    // refresh`. `ui/Modal` renders its footer with NO top spacing of its own,
    // so every caller supplies it — `pt-4` is the established spelling
    // (GroupConflictDialog, CreateRequestModal).
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const footer = screen.getByTestId('modal-footer')
    expect(footer.firstElementChild?.className).toMatch(/\bpt-4\b/)
  })

  it('lists NO job or table names (kindred#2478 §4.1)', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const text = screen.getByRole('dialog').textContent ?? ''
    for (const service of [
      'attendees',
      'persons',
      'person_custom_values',
      'household_custom_values',
      'family_camp_derived',
      'lodging_assignments',
    ]) {
      expect(text).not.toContain(service)
    }
  })

  it('starts the chain on confirm and closes the modal', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start refresh/i }))
    await waitFor(() => expect(refreshFamilyCamp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  /**
   * `POST /refresh-family-camp` is gated on `bunking.manage`, so it must go out
   * through `fetchWithAuth` — the repo rule is that a protected endpoint carries
   * a header-assert test (`frontend/CLAUDE.md`).
   *
   * Every other test here mocks BOTH the service and `useApiWithAuth`, so none
   * of them can see the wiring between the two: swapping `fetchWithAuth` for a
   * bare `fetch` would leave them all green and every request unauthenticated.
   * This asserts the identity of the function handed to the service, which is
   * the seam those mocks otherwise hide.
   */
  it('sends the request through fetchWithAuth, not a bare fetch', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start refresh/i }))
    await waitFor(() => expect(refreshFamilyCamp).toHaveBeenCalledTimes(1))
    expect(refreshFamilyCamp).toHaveBeenCalledWith(fetchWithAuth, TEST_SESSION.session_cm_id)
  })
})

describe('RefreshHousingButton — scoped to the weekend in view (kindred#2601)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFromServer = 'Tamarack 1'
    setStatus(status())
  })

  /**
   * The press covers ONE weekend, not the season. Before kindred#2601 the two
   * bounded custom-values jobs swept every family-camp weekend in the year —
   * measured 782 persons against 175 for the largest single weekend, and those
   * two jobs are ~96% of the chain's runtime.
   *
   * Asserting the ARGUMENT rather than the elapsed time is the point: a press
   * that silently refreshed all ten weekends would look identical on screen.
   */
  it('refreshes the weekend on screen, not the whole season', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start refresh/i }))
    await waitFor(() => expect(refreshFamilyCamp).toHaveBeenCalledTimes(1))
    expect(refreshFamilyCamp).toHaveBeenCalledWith(fetchWithAuth, 900)
  })

  /**
   * The button lives in the app shell's nav, not on the board, so nothing else
   * on screen says which weekend it acts on. Naming it is what makes the
   * narrowed scope honest rather than merely faster.
   */
  it('names the weekend it is about to refresh', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    expect(screen.getByRole('dialog').textContent).toMatch(
      /Family Camp 5: Extended Program Weekend/
    )
  })

  /**
   * ── Per-weekend freshness (kindred#2601) ──────────────────────────────────
   *
   * The freshness sentence answers "how current is what I am looking at", so its
   * source is the job that PULLS FROM CAMPMINDER for this weekend — the bounded
   * custom-values pass — not `lodging_assignments`, which is a year-wide
   * transform that runs on every press regardless of which weekend was fetched.
   * Reading the transform is what made the old copy season-wide.
   */
  it('dates the freshness from an UNSCOPED run, which covered every weekend', () => {
    setStatus(
      status({
        household_custom_values_family_camp: {
          status: 'success',
          end_time: '2026-04-22T09:13:00.000Z',
        },
      })
    )
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    expect(screen.getByRole('dialog').textContent).toMatch(/won't show here yet/i)
  })

  it('dates the freshness from a run scoped to THIS weekend', () => {
    setStatus(
      status({
        household_custom_values_family_camp: {
          status: 'success',
          end_time: '2026-04-22T09:13:00.000Z',
          session: '900',
        },
      })
    )
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    expect(screen.getByRole('dialog').textContent).toMatch(/won't show here yet/i)
  })

  /**
   * 🚨 THE ONE THAT MATTERS. Refresh weekend A, open weekend B: B was NOT
   * covered, and the single status slot cannot say how much older B is — the
   * nightly cron's earlier run has already been overwritten. Claiming A's
   * timestamp for B is the defect; inventing a different number would be worse.
   * So B says nothing about staleness until run history exists (kindred#2617).
   */
  it("says NOTHING about staleness when the last run was another weekend's", () => {
    setStatus(
      status({
        household_custom_values_family_camp: {
          status: 'success',
          end_time: '2026-04-22T09:13:00.000Z',
          session: '1001',
        },
      })
    )
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).not.toMatch(/won't show here yet/i)
    expect(text).not.toMatch(/ago/)
    // The cost half of the dialog is unaffected — the press still works.
    expect(text).toMatch(/2–4 minutes/)
  })

  /**
   * 🚨 THE REGRESSION PIN FOR THE FRESHNESS CLAIM.
   *
   * `lastSynced` is `lodging_assignments.end_time` — ONE year-wide job status
   * with no session dimension. Naming the weekend beside it was true only while
   * every press covered every weekend; scoping the press made it false, and the
   * first draft of kindred#2601 shipped exactly that sentence.
   *
   * The weekend name belongs on the TITLE and the action — claims about what
   * this press will DO — and must stay off the timestamp, which describes data
   * this press did not necessarily touch. This asserts the split rather than the
   * absence, so it still fails if someone re-attaches the name to the time.
   */
  it('does NOT attribute the freshness sentence to this weekend by name', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const dialog = screen.getByRole('dialog')

    const freshnessLine = Array.from(dialog.querySelectorAll('p')).find((p) =>
      /won't show here yet/i.test(p.textContent ?? '')
    )
    expect(freshnessLine).toBeDefined()
    expect(freshnessLine?.textContent).not.toMatch(/Family Camp 5/)

    // ...while the weekend IS still named where the claim is about the action.
    expect(dialog.textContent).toMatch(/Family Camp 5: Extended Program Weekend/)
  })

  /**
   * The stated cost has to move WITH the scope. Leaving "13½ minutes" over a
   * press that now takes two to four would be a true sentence about the old
   * behaviour and a false one about this button — the same trade kindred#2600
   * refused when a phase header claimed a job count its own action did not run.
   */
  it('states the scoped cost, not the whole-season one', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).toMatch(/2–4 minutes/)
    expect(text).not.toMatch(/13½/)
  })
})

describe('RefreshHousingButton — the running state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFromServer = 'Tamarack 1'
    setStatus(status())
  })

  it('replaces the button in place with a status and a bar, and offers no cancel', () => {
    setStatus(
      status({
        person_custom_values_family_camp: {
          status: 'running',
          start_time: new Date(Date.now() - 60_000).toISOString(),
        },
      })
    )
    renderButton()
    expect(screen.getByText(/Refreshing housing/)).toBeInTheDocument()
    expect(screen.getByText(/min left/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // ⛔ No cancel (§4.1): the button is GONE, not disabled, and nothing has
    // replaced it that can be pressed.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the running state on a fresh mount — it survives reload and navigation', () => {
    setStatus(status({ attendees: { status: 'running', start_time: new Date().toISOString() } }))
    renderButton()
    expect(screen.getByText(/Refreshing housing/)).toBeInTheDocument()
  })

  it('does NOT claim a refresh is running during the nightly daily sync', () => {
    setStatus(
      status({
        attendees: { status: 'running', start_time: new Date().toISOString() },
        _daily_sync_running: true,
        _current_run: { type: 'daily', total_jobs: 25, completed_jobs: 4, remaining_jobs: [] },
      })
    )
    renderButton()
    expect(screen.queryByText(/Refreshing housing/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh Housing/i })).toBeInTheDocument()
  })
})

describe('RefreshHousingButton — the cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFromServer = 'Tamarack 1'
    setStatus(status())
  })

  it('LANDS THE NEW PLACEMENTS ON THE BOARD, not just a toast (§4.3)', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { client } = renderButton()
    await screen.findByText('Tamarack 1')
    expect(screen.getByText(/Refreshing housing/)).toBeInTheDocument()

    // The chain finishes and CampMinder's newer placement is now what the
    // roster endpoint returns.
    rosterFromServer = 'Tamarack 2'
    await poll(
      client,
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )

    // WITHOUT the invalidation this stays "Tamarack 1" for thirty minutes.
    await waitFor(() => expect(screen.getByTestId('roster').textContent).toBe('Tamarack 2'))
  })

  it('announces the cutover without counting anything', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { client } = renderButton()
    await poll(
      client,
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    const message = String(toastSuccess.mock.calls[0]?.[0] ?? '')
    expect(message).toBe('Housing refreshed from CampMinder')
    // ⛔ No count: that would be the compare arriving through the back door.
    expect(message).not.toMatch(/\d/)
  })

  /**
   * The PRESS path, end to end — every other cutover test here mounts with a
   * chain job already running, so the hook takes its `phase === 'idle'` pickup
   * branch and `start()` is never called at all. That left the weekend surface
   * with no coverage of the arming path #2596 rewrote, while summer's
   * equivalent (`lands the refreshed bunks on the board at the cutover`, in
   * AppLayout.test.tsx) has had it throughout. Weekend models summer.
   *
   * The middle step is the one that matters: the press's OWN refetch is what
   * confirms the baseline, and until it settles there are no grounds to call
   * anything moved (kindred#2595, kindred#2599).
   */
  it('LANDS THE NEW PLACEMENTS after a PRESS, not just after a mid-run pickup', async () => {
    setStatus(status())
    const { client } = renderButton()
    await screen.findByText('Tamarack 1')

    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start refresh/i }))
    await waitFor(() => expect(refreshFamilyCamp).toHaveBeenCalledTimes(1))

    // `start()`'s own invalidation refetches and settles here, in the arming
    // gap: nothing has moved yet, and that reading is the baseline.
    await settlePress()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByTestId('roster').textContent).toBe('Tamarack 1')

    // The chain finishes: CampMinder's newer placement is now what the roster
    // endpoint returns, and the terminal job's end_time has moved.
    rosterFromServer = 'Tamarack 2'
    await poll(
      client,
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )

    // WITHOUT the invalidation this stays "Tamarack 1" for thirty minutes.
    await waitFor(() => expect(screen.getByTestId('roster').textContent).toBe('Tamarack 2'))
    expect(toastSuccess).toHaveBeenCalledTimes(1)
  })

  it('returns to the resting button after the cutover', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { client } = renderButton()
    await poll(
      client,
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Refresh Housing/i })).toBeInTheDocument()
    )
  })
})

describe('RefreshHousingButton — failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rosterFromServer = 'Tamarack 1'
    setStatus(status())
  })

  it('shows an error toast and nothing more, and does NOT refresh the board', async () => {
    setStatus(status({ persons: { status: 'running', start_time: new Date().toISOString() } }))
    const { client } = renderButton()
    await screen.findByText('Tamarack 1')

    rosterFromServer = 'Tamarack 2'
    await poll(
      client,
      status({
        persons: {
          status: 'failed',
          end_time: '2026-04-22T10:30:00.000Z',
          error: 'CampMinder 502',
        },
      })
    )

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastSuccess).not.toHaveBeenCalled()
    // The board never moved, because nothing landed — §4.4: the two jobs that
    // touch what staff see run last, so an abort leaves the board as it was.
    expect(screen.getByTestId('roster').textContent).toBe('Tamarack 1')
  })

  it('surfaces a rejected POST as an error toast and returns to rest', async () => {
    setStatus(status())
    refreshFamilyCamp.mockRejectedValueOnce(new Error('Failed to refresh family camp housing'))
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Refresh Housing/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start refresh/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Refresh Housing/i })).toBeInTheDocument()
    )
  })
})
