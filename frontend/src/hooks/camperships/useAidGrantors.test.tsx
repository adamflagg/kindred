/** useAidGrantors and its fresh read (spec §8.2; D160). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { GRANTORS, GRANTORS_ALL } from '../../components/camperships/grants/grantorFixtures'
import { useAidGrantors, useFreshAidGrantors } from './useAidGrantors'

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
  granted = ['financial_aid.grantors']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify(String(url).includes('include_retired') ? GRANTORS_ALL : GRANTORS),
          { status: 200 }
        )
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidGrantors', () => {
  it('reads the grantors in use through fetchWithAuth, for grantors alone (no view)', async () => {
    const { result } = renderHook(() => useAidGrantors(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(GRANTORS))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/grantors')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("reads retired grantors and a season's grants when asked", async () => {
    const { result } = renderHook(() => useAidGrantors({ includeRetired: true, year: 2027 }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data).toEqual(GRANTORS_ALL))
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/financial-aid/grantors?include_retired=true&year=2027'
    )
  })

  it('reads nothing for summary alone, or when the page turns it off', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidGrantors(), { wrapper })
    granted = ['financial_aid.view']
    renderHook(() => useAidGrantors({ enabled: false }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the fresh read goes past a warm cache, retired included (Decision P-9)', async () => {
    const { result } = renderHook(
      () => ({ list: useAidGrantors({ includeRetired: true }), fresh: useFreshAidGrantors() }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.list.data).toEqual(GRANTORS_ALL))
    await act(() => result.current.fresh())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/financial-aid/grantors?include_retired=true')
  })
})
