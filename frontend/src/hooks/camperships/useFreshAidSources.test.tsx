/** useFreshAidSources: the registry read past the cache (Decision P-9). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { SOURCES_2027 } from '../../components/camperships/money/registryFixtures'
import { useAidSources, useFreshAidSources } from './useAidSources'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  // The app's own default (utils/queryClient.ts): a warm cache stays fresh for 30 minutes.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30 * 60 * 1000 } },
  })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(SOURCES_2027), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useFreshAidSources (Decision P-9)', () => {
  it("reads past a warm cache, the season's registry, carrying the JWT", async () => {
    const { result } = renderHook(() => ({ list: useAidSources(), fresh: useFreshAidSources() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.list.data).toEqual(SOURCES_2027))
    let latest: unknown
    await act(async () => {
      latest = await result.current.fresh()
    })
    expect(latest).toEqual(SOURCES_2027)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [url, options] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/sources?year=2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })
})
