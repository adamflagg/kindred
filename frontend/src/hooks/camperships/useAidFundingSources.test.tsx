/** useAidFundingSources and its fresh read (D100; Decision P-14). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { FUNDING_SOURCES_2027 } from '../../components/camperships/money/registryFixtures'
import { useAidFundingSources, useFreshAidFundingSources } from './useAidFundingSources'

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  // The app's own default (utils/queryClient.ts): a warm cache stays fresh for 30 minutes.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30 * 60 * 1000 } },
  })
  granted = ['financial_aid.view']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(FUNDING_SOURCES_2027), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidFundingSources', () => {
  it("reads the season's groups through fetchWithAuth", async () => {
    const { result } = renderHook(() => useAidFundingSources(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(FUNDING_SOURCES_2027))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/funding-sources')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing for grantors alone (the route is view or summary)', async () => {
    granted = ['financial_aid.grantors']
    renderHook(() => useAidFundingSources(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the fresh read goes past a warm cache (Decision P-9)', async () => {
    const { result } = renderHook(
      () => ({ list: useAidFundingSources(), fresh: useFreshAidFundingSources() }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.list.data).toEqual(FUNDING_SOURCES_2027))
    await act(() => result.current.fresh())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
