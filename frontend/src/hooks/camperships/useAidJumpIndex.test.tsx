/**
 * useAidJumpIndex: the jump box's one read (§3.5). `useApiWithAuth` is deliberately NOT mocked:
 * the header assertion reads what reaches the network, which proves the PocketBase JWT travels.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidJumpIndex } from './useAidJumpIndex'

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
let year = 2027
vi.mock('../useCurrentYear', () => ({ useYear: () => year }))

let fetchSpy: MockInstance<typeof fetch>
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  year = 2027
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ year: 2027, households: [] }), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidJumpIndex', () => {
  it('loads the index once through fetchWithAuth, carrying the PocketBase JWT', async () => {
    renderHook(() => useAidJumpIndex(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/jump-index/2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing for a summary-only user, who has no jump box (D65)', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidJumpIndex(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads nothing before the season is known', async () => {
    year = 0
    renderHook(() => useAidJumpIndex(), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
