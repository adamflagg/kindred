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
vi.mock('../../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetchWithAuth,
    isAuthenticated: true,
    isAuthLoading: false,
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

/** What a `vi.fn().mockResolvedValue(...)` spy looks like from the caller's side. */
type FetchWithAuthSpy = (url: string, init?: RequestInit) => Promise<unknown>

interface RenderProvidersOptions {
  /**
   * Stands in for the underlying network layer. `renderWithProviders` wraps
   * it the same way the real `useApiWithAuth` wraps `fetch` — attaching an
   * Authorization header — so a caller that reaches this spy at all proves it
   * went through `fetchWithAuth`, and the header on what it received proves
   * that wrapping happened rather than a bare `fetch`.
   */
  fetchWithAuth?: FetchWithAuthSpy
  preview?: Partial<RollForwardPlanFixture>
}

function renderWithProviders(ui: ReactElement, options: RenderProvidersOptions = {}) {
  if (options.fetchWithAuth) {
    const spy = options.fetchWithAuth
    mockFetchWithAuth.mockImplementation((url: string, init?: RequestInit) => {
      const headers = {
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: 'Bearer test-token',
      }
      return spy(url, { ...init, headers })
    })
  } else {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...DEFAULT_PLAN, ...options.preview }),
    })
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CurrentYearContext.Provider value={YEAR_CONTEXT}>{ui}</CurrentYearContext.Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockFetchWithAuth.mockReset()
})

describe('SeasonRollForwardPanel', () => {
  it('sends the auth header on the preview request', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          from_year: 2026,
          to_year: 2027,
          units_to_create: 118,
          areas_to_create: 10,
          units_present: 0,
          areas_present: 0,
          unit_codes: [],
          skipped_codes: [],
        }),
    })
    renderWithProviders(<SeasonRollForwardPanel />, { fetchWithAuth: spy })

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [, init] = spy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBeTruthy()
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
})
