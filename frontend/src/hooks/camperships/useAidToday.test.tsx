import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidToday } from '../../types/api-types'
import { useAidToday } from './useAidToday'

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

const TODAY: ApiAidToday = { year: 2027, casework: [], finance: null }
let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(TODAY), { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidToday', () => {
  it('reads Today through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidToday(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TODAY))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/today/2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing when not enabled', async () => {
    renderHook(() => useAidToday({ enabled: false }), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
