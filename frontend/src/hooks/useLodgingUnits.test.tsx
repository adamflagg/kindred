/**
 * The Units query, centralised out of LodgingUnitsPanel, LodgingAliasesPanel
 * and UnresolvedAliasQueue (kindred#1896), which each declared it separately.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { CurrentYearContext, type CurrentYearContextType } from './useCurrentYear'
import { useLodgingUnits } from './useLodgingUnits'

const listLodgingUnits = vi.fn()

vi.mock('../services/lodgingCrud', () => ({
  listLodgingUnits: (...args: unknown[]) => listLodgingUnits(...args),
}))

const UNITS = [{ id: 'u1', name: 'Cedar 1', code: 'cedar-1' }]

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  listLodgingUnits.mockResolvedValue(UNITS)
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

describe('useLodgingUnits', () => {
  it('fetches the current season', async () => {
    const { result } = renderHook(() => useLodgingUnits(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.data).toEqual(UNITS)
    })
    expect(listLodgingUnits).toHaveBeenCalledWith(2026)
  })

  it('shares a cache entry under the centralised query key', async () => {
    // Three components each declared this query separately before #1896;
    // centralising means they now read one cache entry rather than each
    // trusting its own copy of the key and the `?? []` fallback to agree.
    const { result } = renderHook(() => useLodgingUnits(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(client.getQueryData(queryKeys.lodgingUnits(2026))).toEqual(UNITS)
  })

  it('does not fetch until the year resolves', () => {
    // CurrentYearContext returns the literal 0 until the backend supplies the
    // configured year, and PocketBase answers `year = 0` with a successful
    // `200 []` rather than an error — an ungated query would render a false
    // empty state.
    renderHook(() => useLodgingUnits(), {
      wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
    })
    expect(listLodgingUnits).not.toHaveBeenCalled()
  })
})
