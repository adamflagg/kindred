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
import { useAidHistory, useAidHistoryOperation } from './useAidHistory'

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

describe('useAidHistory', () => {
  it("reads one page of the season's log through fetchWithAuth, with the page's query", async () => {
    const { result } = renderHook(() => useAidHistory({ kind: 'holds', per_page: '50' }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data).toEqual(PAGE))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/history/2027?kind=holds&per_page=50')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without view (D49: History is a view surface)', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidHistory({ per_page: '50' }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps the page on screen while the next one loads, never another season's", async () => {
    const firstQuery: Record<string, string> = { per_page: '50' }
    let finishNext: ((value: Response) => void) | undefined
    const { result, rerender } = renderHook(
      ({ query }: { query: Record<string, string> }) => useAidHistory(query),
      { wrapper, initialProps: { query: firstQuery } }
    )
    await waitFor(() => expect(result.current.data).toEqual(PAGE))
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishNext = resolve
        })
    )
    rerender({ query: { page: '2', per_page: '50' } })
    expect(result.current.data).toEqual(PAGE)
    finishNext?.(new Response(JSON.stringify({ ...PAGE, page: 2 }), { status: 200 }))
    await waitFor(() => expect(result.current.data?.page).toBe(2))
    season = 2028
    rerender({ query: { per_page: '50' } })
    expect(result.current.data).toBeUndefined()
  })
})

describe('useAidHistoryOperation', () => {
  it("reads one operation's rows through fetchWithAuth", async () => {
    fetchSpy.mockImplementation(() => ok(DETAIL_POSTED))
    const { result } = renderHook(() => useAidHistoryOperation('op0000000000003'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(DETAIL_POSTED))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/history/2027/operations/op0000000000003')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
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
})
