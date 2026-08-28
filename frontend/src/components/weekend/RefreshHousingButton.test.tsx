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
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { SyncStatusResponse } from '../../hooks/useSyncStatusAPI'
import { queryKeys } from '../../utils/queryKeys'

const syncStatusSpy = vi.fn((_opts?: unknown): { data: SyncStatusResponse | null | undefined } => ({
  data: undefined,
}))
vi.mock('../../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: (...args: unknown[]) => syncStatusSpy(...args),
}))

const refreshFamilyCamp = vi.fn((..._args: unknown[]) => Promise.resolve({ status: 'started' }))
vi.mock('../../services/sync', () => ({
  syncService: { refreshFamilyCamp: (...a: unknown[]) => refreshFamilyCamp(...a) },
}))

vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
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

function setStatus(s: SyncStatusResponse) {
  syncStatusSpy.mockImplementation(() => ({ data: s }))
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

function renderButton(client = makeClient()) {
  const utils = render(
    <QueryClientProvider client={client}>
      <RosterProbe />
      <RefreshHousingButton />
    </QueryClientProvider>
  )
  return { ...utils, client }
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
    expect(dialog.textContent).toMatch(/13½ minutes/)
    expect(dialog.textContent).toMatch(/not here yet/i)
    expect(dialog.textContent).toMatch(/ago/)
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
  })

  it('LANDS THE NEW PLACEMENTS ON THE BOARD, not just a toast (§4.3)', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { rerender, client } = renderButton()
    await screen.findByText('Tamarack 1')
    expect(screen.getByText(/Refreshing housing/)).toBeInTheDocument()

    // The chain finishes and CampMinder's newer placement is now what the
    // roster endpoint returns.
    rosterFromServer = 'Tamarack 2'
    setStatus(
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )
    rerender(
      <QueryClientProvider client={client}>
        <RosterProbe />
        <RefreshHousingButton />
      </QueryClientProvider>
    )

    // WITHOUT the invalidation this stays "Tamarack 1" for thirty minutes.
    await waitFor(() => expect(screen.getByTestId('roster').textContent).toBe('Tamarack 2'))
  })

  it('announces the cutover without counting anything', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { rerender, client } = renderButton()
    setStatus(
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )
    rerender(
      <QueryClientProvider client={client}>
        <RosterProbe />
        <RefreshHousingButton />
      </QueryClientProvider>
    )
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    const message = String(toastSuccess.mock.calls[0]?.[0] ?? '')
    expect(message).toBe('Housing refreshed from CampMinder')
    // ⛔ No count: that would be the compare arriving through the back door.
    expect(message).not.toMatch(/\d/)
  })

  it('returns to the resting button after the cutover', async () => {
    setStatus(
      status({ family_camp_derived: { status: 'running', start_time: new Date().toISOString() } })
    )
    const { rerender, client } = renderButton()
    setStatus(
      status({ lodging_assignments: { status: 'success', end_time: '2026-04-22T10:30:00.000Z' } })
    )
    rerender(
      <QueryClientProvider client={client}>
        <RosterProbe />
        <RefreshHousingButton />
      </QueryClientProvider>
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
  })

  it('shows an error toast and nothing more, and does NOT refresh the board', async () => {
    setStatus(status({ persons: { status: 'running', start_time: new Date().toISOString() } }))
    const { rerender, client } = renderButton()
    await screen.findByText('Tamarack 1')

    rosterFromServer = 'Tamarack 2'
    setStatus(
      status({
        persons: {
          status: 'failed',
          end_time: '2026-04-22T10:30:00.000Z',
          error: 'CampMinder 502',
        },
      })
    )
    rerender(
      <QueryClientProvider client={client}>
        <RosterProbe />
        <RefreshHousingButton />
      </QueryClientProvider>
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
