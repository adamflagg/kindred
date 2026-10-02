/** The household page's read (§6.3): fetchWithAuth's JWT, and a 404 said at once. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { householdPage } from '../../components/camperships/household/householdFixtures'
import { useAidHouseholdPage } from './useAidHouseholdPage'

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
  // The app's own retry rule is replaced by the hook's, so no retry: false here.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(householdPage()), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidHouseholdPage', () => {
  it('sends the protected read through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidHouseholdPage(1000001), { wrapper })
    await waitFor(() => expect(result.current.data?.household_cm_id).toBe(1000001))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/household-page/2027/1000001')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('takes a 404 (no aid activity) at its word, without retrying', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'no aid activity' }), { status: 404 }))
    )
    const { result } = renderHook(() => useAidHouseholdPage(1000009), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reads nothing for household 0', async () => {
    renderHook(() => useAidHouseholdPage(0), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
