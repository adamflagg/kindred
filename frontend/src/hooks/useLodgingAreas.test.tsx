/**
 * The Areas query, centralised out of LodgingAreasDrawer and LodgingUnitsPanel
 * (kindred#1896), which each declared it separately with their own `?? []`
 * coercion.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { CurrentYearContext, type CurrentYearContextType } from './useCurrentYear'
import { useLodgingAreas } from './useLodgingAreas'

const listLodgingAreas = vi.fn()

vi.mock('../services/lodgingCrud', () => ({
  listLodgingAreas: (...args: unknown[]) => listLodgingAreas(...args),
}))

const AREAS = [
  { id: 'a1', name: 'North Zone', code: 'NORTH', map_x: 0.2, map_y: 0.3, sort_order: 1 },
]

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  listLodgingAreas.mockResolvedValue(AREAS)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

const YEAR_CONTEXT: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026],
  isTransitioning: false,
  isYearReady: true,
}

function wrapper(context: CurrentYearContextType) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <CurrentYearContext.Provider value={context}>{children}</CurrentYearContext.Provider>
      </QueryClientProvider>
    )
  }
}

describe('useLodgingAreas', () => {
  it('fetches the current season by default', async () => {
    const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.data).toEqual(AREAS)
    })
    expect(listLodgingAreas).toHaveBeenCalledWith(2026)
  })

  it('shares a cache entry across consumers under the centralised query key', async () => {
    // The two duplicated inline declarations this hook replaces each had
    // their own `?? []` coercion — the point of centralising is that both
    // consumers now read the SAME cache entry rather than issuing their own
    // fetch under a key they happened to spell identically.
    const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(client.getQueryData(queryKeys.lodgingAreas(2026))).toEqual(AREAS)
  })

  it('does not fetch until the year resolves', () => {
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — an ungated query would render a false
    // empty state.
    renderHook(() => useLodgingAreas(), {
      wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
    })
    expect(listLodgingAreas).not.toHaveBeenCalled()
  })

  it('does not fetch when the caller passes enabled: false, even with a resolved year', () => {
    // The drawer only wants this while open. The extra gate must AND with
    // year-readiness, not replace it — see the next test.
    renderHook(() => useLodgingAreas({ enabled: false }), { wrapper: wrapper(YEAR_CONTEXT) })
    expect(listLodgingAreas).not.toHaveBeenCalled()
  })

  it('still withholds the fetch when enabled is true but the year has not resolved', () => {
    renderHook(() => useLodgingAreas({ enabled: true }), {
      wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
    })
    expect(listLodgingAreas).not.toHaveBeenCalled()
  })
})
