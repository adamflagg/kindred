/** Today's week read (spec 2026-10-10 §8). `useApiWithAuth` is NOT mocked: the header assertion reads what reaches the network. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidTodayWeek } from './useAidTodayWeek'

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

const WEEK_BODY = { year: 2027, week_of: '2027-04-05', registrar: [], feed: [] }

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  granted = []
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(WEEK_BODY), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidTodayWeek', () => {
  it('reads /today/{year}/week through fetchWithAuth for development (grantors alone)', async () => {
    granted = ['financial_aid.grantors']
    const { result } = renderHook(() => useAidTodayWeek(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(WEEK_BODY))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/today/2027/week')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without a Camperships permission', async () => {
    renderHook(() => useAidTodayWeek(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
