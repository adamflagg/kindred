/**
 * Carry the lodging registry forward: preview then apply, modelled on
 * PopulateFromPreviousYear's test shape but against a single server-side
 * roll-forward endpoint rather than several client-computed previews.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'
import { queryKeys } from '../../../utils/queryKeys'
import { SeasonRollForwardPanel } from './SeasonRollForwardPanel'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

// Module-scoped so `vi.mock` can close over it; `renderWithProviders` rewires
// its implementation per test.
const mockFetchWithAuth = vi.fn()
// Mutable so a test can put the hook in its still-resolving state; reset in
// beforeEach below alongside the fetch mock.
let mockIsAuthLoading = false
vi.mock('../../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: mockIsAuthLoading,
  }),
}))

const YEAR_CONTEXT: CurrentYearContextType = {
  currentYear: 2027,
  setCurrentYear: vi.fn(),
  availableYears: [2026, 2027],
  isTransitioning: false,
  isYearReady: true,
}

interface RollForwardPlanFixture {
  from_year: number
  to_year: number
  areas_to_create: number
  units_to_create: number
  areas_present: number
  units_present: number
  unit_codes: string[]
  skipped_codes: string[]
}

const DEFAULT_PLAN: RollForwardPlanFixture = {
  from_year: 2026,
  to_year: 2027,
  areas_to_create: 0,
  units_to_create: 0,
  areas_present: 0,
  units_present: 0,
  unit_codes: [],
  skipped_codes: [],
}

interface RenderProvidersOptions {
  preview?: Partial<RollForwardPlanFixture>
}

function renderWithProviders(ui: ReactElement, options: RenderProvidersOptions = {}) {
  mockFetchWithAuth.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ...DEFAULT_PLAN, ...options.preview }),
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CurrentYearContext.Provider value={YEAR_CONTEXT}>{ui}</CurrentYearContext.Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockIsAuthLoading = false
  mockFetchWithAuth.mockReset()
})

describe('SeasonRollForwardPanel', () => {
  it('routes both the preview and the apply call through fetchWithAuth, never a bare fetch', async () => {
    // `useApiWithAuth` is mocked wholesale (module scope, above) so
    // `mockFetchWithAuth` stands in for the real wrapper that attaches the
    // PocketBase JWT — the JWT lives in localStorage, not a cookie, so a bare
    // `fetch` would carry no Authorization header and 401 silently. Asserting
    // only that a header exists on whatever reaches an already-cooperating
    // mock proves nothing; the property worth pinning is that the raw network
    // layer is never touched directly, for EITHER call this component makes.
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    renderWithProviders(<SeasonRollForwardPanel />, {
      preview: { units_to_create: 1, unit_codes: ['test-unit-b'] },
    })

    const applyButton = await screen.findByRole('button', { name: /carry.*forward/i })
    await user.click(applyButton)

    // Preview GET on mount, apply POST on click, then a THIRD call: apply's
    // onSuccess invalidates the preview key, and react-query refetches it
    // immediately since this component is still mounted and observing it.
    // All three into the injected fetchWithAuth, zero into the raw fetch a
    // caller could reach for instead.
    await waitFor(() => expect(mockFetchWithAuth).toHaveBeenCalledTimes(3))
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('reports what will be created before anything is written', async () => {
    renderWithProviders(<SeasonRollForwardPanel />, {
      preview: {
        units_to_create: 118,
        areas_to_create: 10,
        units_present: 0,
        areas_present: 0,
        unit_codes: [],
        skipped_codes: [],
      },
    })
    expect(await screen.findByText(/118 units/)).toBeInTheDocument()
    expect(screen.getByText(/10 areas/)).toBeInTheDocument()
  })

  it('disables apply when there is nothing to create', async () => {
    renderWithProviders(<SeasonRollForwardPanel />, {
      preview: {
        units_to_create: 0,
        areas_to_create: 0,
        units_present: 118,
        areas_present: 10,
        unit_codes: [],
        skipped_codes: ['test-unit-a'],
      },
    })
    expect(await screen.findByRole('button', { name: /nothing to carry forward/i })).toBeDisabled()
  })

  it('names the units it left alone', async () => {
    renderWithProviders(<SeasonRollForwardPanel />, {
      preview: {
        units_to_create: 1,
        areas_to_create: 0,
        units_present: 1,
        areas_present: 10,
        unit_codes: ['test-unit-b'],
        skipped_codes: ['test-unit-a'],
      },
    })
    expect(await screen.findByText(/test-unit-a/)).toBeInTheDocument()
  })

  it('does not fetch the preview before the season resolves', () => {
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — the same trap useWeekendRoster.ts:30-37
    // guards against. Without `enabled: toYear > 0` this fires `from=-1&to=0`
    // on every cold load and renders a confident "nothing to carry forward".
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(DEFAULT_PLAN),
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const zeroYear: CurrentYearContextType = { ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }
    render(
      <QueryClientProvider client={queryClient}>
        <CurrentYearContext.Provider value={zeroYear}>
          <SeasonRollForwardPanel />
        </CurrentYearContext.Provider>
      </QueryClientProvider>
    )
    expect(mockFetchWithAuth).not.toHaveBeenCalled()
  })

  it('applies through a POST and invalidates the weekend roster, not just the registry keys', async () => {
    // The critical, easy-to-miss half of this task: the weekend queries run a
    // long staleTime (utils/queryClient.ts), so a registry-only invalidation
    // leaves a stale roster on screen for the length of it. Only
    // `invalidateLodgingRegistryQueries` reaches `weekend-roster` as well as
    // `lodging-units` / `lodging-areas`.
    const user = userEvent.setup()
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ ...DEFAULT_PLAN, units_to_create: 1, unit_codes: ['test-unit-b'] }),
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(queryKeys.weekendRoster(2027, 1000001, ''), { year: 2027 })
    queryClient.setQueryData(queryKeys.lodgingUnits(2027), [])

    render(
      <QueryClientProvider client={queryClient}>
        <CurrentYearContext.Provider value={YEAR_CONTEXT}>
          <SeasonRollForwardPanel />
        </CurrentYearContext.Provider>
      </QueryClientProvider>
    )

    const applyButton = await screen.findByRole('button', { name: /carry.*forward/i })
    await user.click(applyButton)

    await waitFor(() =>
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('/api/custom/lodging/roll-forward'),
        expect.objectContaining({ method: 'POST' })
      )
    )

    await waitFor(() => {
      expect(
        queryClient.getQueryState(queryKeys.weekendRoster(2027, 1000001, ''))?.isInvalidated
      ).toBe(true)
      expect(queryClient.getQueryState(queryKeys.lodgingUnits(2027))?.isInvalidated).toBe(true)
    })
  })

  // The `enabled` gate stops the REQUEST when the year is unresolved, and the
  // panel's prose is not gated at all -- so a cold load rendered "Copy -1's
  // areas and units forward as a starting point for 0." fromYear is
  // `currentYear - 1`, and CurrentYearContext returns the literal 0 until the
  // backend answers.
  it('does not offer to copy year -1 into year 0 before the season resolves', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const zeroYear: CurrentYearContextType = { ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }
    render(
      <QueryClientProvider client={queryClient}>
        <CurrentYearContext.Provider value={zeroYear}>
          <SeasonRollForwardPanel />
        </CurrentYearContext.Provider>
      </QueryClientProvider>
    )
    expect(screen.queryByText(/-1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/starting point for 0/)).not.toBeInTheDocument()
  })

  // `useApiWithAuth` reports `isAuthLoading` and this is the only lodging panel
  // that reaches the network through `fetchWithAuth` rather than the PocketBase
  // SDK -- so it is the only one for which the convention applies at all. The
  // sibling panels not doing it is not precedent; they never make a raw call.
  // frontend/CLAUDE.md: "Always check isLoading before making authenticated API
  // calls."
  it('waits for auth to settle before asking what would carry forward', () => {
    mockIsAuthLoading = true
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <CurrentYearContext.Provider value={YEAR_CONTEXT}>
          <SeasonRollForwardPanel />
        </CurrentYearContext.Provider>
      </QueryClientProvider>
    )
    expect(mockFetchWithAuth).not.toHaveBeenCalled()
  })

  it('reports the Details disclosure state to assistive tech', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SeasonRollForwardPanel />, {
      preview: { units_to_create: 2, unit_codes: ['test-unit-a', 'test-unit-b'] },
    })
    const details = await screen.findByRole('button', { name: /details/i })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    // The control has to say WHAT it expanded, not merely that it did.
    expect(details).toHaveAttribute('aria-controls')
    const listId = details.getAttribute('aria-controls')
    expect(listId && document.getElementById(listId)).toBeTruthy()
  })

  // An aria-label overrides the visible text, so while the mutation is pending
  // the button reads "Carrying forward..." on screen and still announces "Carry
  // 2 forward". Repo precedent: 3c01c688, "announce the capacity advisory, not
  // just draw it".
  it('announces that it is working, not the action it already took', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SeasonRollForwardPanel />, { preview: { units_to_create: 2 } })
    const apply = await screen.findByRole('button', { name: /carry 2 forward/i })
    mockFetchWithAuth.mockReturnValue(new Promise(() => {})) // never settles: stay pending
    await user.click(apply)
    expect(await screen.findByRole('button', { name: /carrying forward/i })).toBeInTheDocument()
  })
})
