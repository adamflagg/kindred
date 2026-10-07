/**
 * Season › History's paged read (spec §7.2 C). `useApiWithAuth` is NOT mocked: the header assertion reads
 * what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { PAGE } from '../../components/camperships/season/historyFixtures'
import { useAidHistoryPages } from './useAidHistoryPages'

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
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aid/season/history']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  fetchSpy.mockRestore()
})

const pageOf = (url: string) => new URL(url, 'http://x').searchParams.get('page')

describe('useAidHistoryPages', () => {
  it('reads page 1, then page 2 on fetchNextPage, each with the filters and per_page=50, authorised', async () => {
    const calls: string[] = []
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      calls.push(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-jwt')
      return Promise.resolve(
        new Response(
          JSON.stringify({ ...PAGE, page: Number(pageOf(url)), per_page: 50, total: 112 }),
          { status: 200 }
        )
      )
    })
    const { result } = renderHook(() => useAidHistoryPages({ kind: 'offers', per_page: '50' }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))
    expect(result.current.hasNextPage).toBe(true)
    await act(() => result.current.fetchNextPage())
    expect(calls.map(pageOf)).toEqual(['1', '2'])
    expect(calls.every((url) => url.includes('kind=offers'))).toBe(true)
    expect(calls.every((url) => url.includes('per_page=50'))).toBe(true)
  })

  it('has no next page once every operation is read', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...PAGE, page: 1, per_page: 50, total: 3 }), {
          status: 200,
        })
      )
    )
    const { result } = renderHook(() => useAidHistoryPages({ per_page: '50' }), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.hasNextPage).toBe(false)
  })
})
