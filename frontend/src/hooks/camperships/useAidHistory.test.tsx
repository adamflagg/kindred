/**
 * Season › History's reads (spec §7.6; D49, D21). `useApiWithAuth` is NOT mocked: the header
 * assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { DETAIL_POSTED, PAGE } from '../../components/camperships/season/historyFixtures'
import { useAidHistoryOperation } from './useAidHistory'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = ['financial_aid.view']
vi.mock('../usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
let season = 2027
vi.mock('../useCurrentYear', () => ({ useYear: () => season }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aid/season/history']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  season = 2027
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok(PAGE))
})
afterEach(() => {
  fetchSpy.mockRestore()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidHistoryOperation', () => {
  it("reads one operation's rows through fetchWithAuth", async () => {
    fetchSpy.mockImplementation(() => ok(DETAIL_POSTED))
    const { result } = renderHook(() => useAidHistoryOperation('op0000000000003'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DETAIL_POSTED))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/history/2027/operations/op0000000000003')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing while { enabled: false }, for a caller that opens it later', async () => {
    renderHook(() => useAidHistoryOperation('op0000000000003', { enabled: false }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers a 404 at once, without the retries a fault gets', async () => {
    // A client that would retry three times, at once: only the hook's own rule stops it.
    client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'no operation' }), { status: 404 }))
    )
    const { result } = renderHook(() => useAidHistoryOperation('op0000000000009'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('answers a 401 at once too: a signed-out reader is not retried', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'expired' }), { status: 401 }))
    )
    const { result } = renderHook(() => useAidHistoryOperation('op0000000000003'), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
