/**
 * The Units query, centralised out of LodgingUnitsPanel, LodgingAliasesPanel
 * and UnresolvedAliasQueue (kindred#1896), which each declared it separately.
 *
 * Fictional data throughout.
 */
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient } from '../test/test-helpers'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
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
  client = createTestQueryClient()
})

/**
 * The options React Query actually resolved for a mounted query, client
 * defaults merged in. Read from the OBSERVER, not the query — see
 * `useWeekendRoster.test.tsx`, which this mirrors.
 */
function resolvedOptions(queryKey: readonly unknown[]) {
  const query = client.getQueryCache().find({ queryKey })
  if (!query) throw new Error(`no query cached for ${JSON.stringify(queryKey)}`)
  const observer = query.observers[0]
  if (!observer) throw new Error(`query ${JSON.stringify(queryKey)} has no mounted observer`)
  return observer.options
}

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

  it('resolves fetched data under the centralised `queryKeys.lodgingUnits` key', async () => {
    // NOTE on what this does and does not prove: all three consumers already
    // called `queryKeys.lodgingUnits(currentYear)` before this hook existed
    // (they already shared the factory), so a single cache entry across
    // consumers is not new behaviour this hook introduces — reverting to
    // three independent inline `useQuery` calls that each spell the key via
    // the same factory still shares one entry. What centralising buys is that
    // there is now exactly ONE place that could get the key, the options, or
    // the `?? []` coercion (see `.items` below) wrong instead of several.
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

  describe('.items', () => {
    it('coerces to an empty array before the query settles, so callers need no `?? []`', () => {
      const { result } = renderHook(() => useLodgingUnits(), {
        wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
      })
      expect(result.current.data).toBeUndefined()
      expect(result.current.items).toEqual([])
    })

    it('mirrors `.data` once the query resolves', async () => {
      const { result } = renderHook(() => useLodgingUnits(), { wrapper: wrapper(YEAR_CONTEXT) })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(result.current.items).toEqual(UNITS)
    })
  })

  it('pins the cache options to userDataOptions, so opting down needs a stated reason', async () => {
    const { result } = renderHook(() => useLodgingUnits(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const options = resolvedOptions(queryKeys.lodgingUnits(2026))
    expect(options.staleTime).toBe(userDataOptions.staleTime)
    expect(options.gcTime).toBe(userDataOptions.gcTime)
    expect(options.refetchOnWindowFocus).toBe(userDataOptions.refetchOnWindowFocus)
  })
})
