/**
 * The Areas query, centralised out of LodgingAreasDrawer and LodgingUnitsPanel
 * (kindred#1896), which each declared it separately with their own `?? []`
 * coercion.
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

describe('useLodgingAreas', () => {
  it('fetches the current season by default', async () => {
    const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.data).toEqual(AREAS)
    })
    expect(listLodgingAreas).toHaveBeenCalledWith(2026)
  })

  it('resolves fetched data under the centralised `queryKeys.lodgingAreas` key', async () => {
    // NOTE on what this does and does not prove: the drawer and the units
    // table both called `queryKeys.lodgingAreas(currentYear)` even before this
    // hook existed (they already shared the factory), so a single cache entry
    // for two consumers is not new behaviour this hook introduces — reverting
    // to two independent inline `useQuery` calls that each spell the key via
    // the same factory still shares one entry. What centralising buys is that
    // there is now exactly ONE place that could get the key, the options, or
    // the `?? []` coercion (see `.items` below) wrong instead of several.
    const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(client.getQueryData(queryKeys.lodgingAreas(2026))).toEqual(AREAS)
  })

  it('fetches once for two concurrent consumers under one QueryClient', async () => {
    // A genuine regression guard for the caching behaviour, not proof that
    // extraction is what CAUSES it — see the NOTE above: two independent
    // inline `useQuery({ queryKey: queryKeys.lodgingAreas(currentYear) })`
    // calls (the actual pre-#1896 shape) also single-fetch here, since
    // TanStack Query dedupes by serialized queryKey regardless of which
    // function issued the call. This still earns its keep: it would catch a
    // future regression where the hook stopped resolving to one shared key
    // (e.g. a per-call cache-buster) even though it wouldn't distinguish
    // "hook" from "two inline copies of the same key".
    const consumerA = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    const consumerB = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(consumerA.result.current.isSuccess).toBe(true)
      expect(consumerB.result.current.isSuccess).toBe(true)
    })
    expect(listLodgingAreas).toHaveBeenCalledTimes(1)
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

  describe('.items', () => {
    it('coerces to an empty array before the query settles, so callers need no `?? []`', () => {
      const { result } = renderHook(() => useLodgingAreas(), {
        wrapper: wrapper({ ...YEAR_CONTEXT, currentYear: 0, isYearReady: false }),
      })
      expect(result.current.data).toBeUndefined()
      expect(result.current.items).toEqual([])
    })

    it('mirrors `.data` once the query resolves', async () => {
      const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })
      expect(result.current.items).toEqual(AREAS)
    })
  })

  it('pins the cache options to userDataOptions, so opting down needs a stated reason', async () => {
    const { result } = renderHook(() => useLodgingAreas(), { wrapper: wrapper(YEAR_CONTEXT) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const options = resolvedOptions(queryKeys.lodgingAreas(2026))
    expect(options.staleTime).toBe(userDataOptions.staleTime)
    expect(options.gcTime).toBe(userDataOptions.gcTime)
    expect(options.refetchOnWindowFocus).toBe(userDataOptions.refetchOnWindowFocus)
  })
})
