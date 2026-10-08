/** useAidSources: the registry's one read (spec §8.1). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { SOURCES } from '../../components/camperships/money/sourcesFixtures'
import { invalidateAidMoneyQueries, queryKeys } from '../../utils/queryKeys'
import { useAidSources } from './useAidSources'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(SOURCES), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidSources', () => {
  it("reads the registry with this season's lines, through fetchWithAuth, for a view holder", async () => {
    granted = ['financial_aid.view']
    const { result } = renderHook(() => useAidSources(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(SOURCES))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/sources?year=2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads it for grantors alone too (owner ruling 2026-10-01)', async () => {
    granted = ['financial_aid.grantors']
    const { result } = renderHook(() => useAidSources(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(SOURCES))
  })

  it('reads nothing for summary alone, or when the page turns it off', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidSources(), { wrapper })
    granted = ['financial_aid.view']
    renderHook(() => useAidSources({ enabled: false }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sits under the sources prefix, so a registry write refreshes it (and no other write does)', () => {
    expect(queryKeys.aidSources(2027).slice(0, 2)).toEqual(queryKeys.aidSourcesPrefix())
    expect(queryKeys.aidSources(2027)).not.toEqual(queryKeys.aidSources(2028))
    const keysOf = (options: { registry?: boolean }) => {
      const invalidateQueries = vi.fn()
      void invalidateAidMoneyQueries({ invalidateQueries }, options)
      return invalidateQueries.mock.calls.map(
        ([args]) => (args as { queryKey: unknown[] }).queryKey
      )
    }
    expect(keysOf({ registry: true })).toContainEqual(queryKeys.aidSourcesPrefix())
    expect(keysOf({})).not.toContainEqual(queryKeys.aidSourcesPrefix())
  })
})
