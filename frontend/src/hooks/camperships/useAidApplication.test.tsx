import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { applicationOut } from '../../components/camperships/household/householdFixtures'
import { useAidApplication } from './useAidApplication'

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
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  granted = ['financial_aid.view']
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(applicationOut()), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidApplication', () => {
  it('reads the household’s application through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidApplication(1000001), { wrapper })
    await waitFor(() => expect(result.current.data?.household_cm_id).toBe(1000001))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/applications/2027/1000001')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('takes a 404 (a household with no application) at its word, and reads nothing for 0', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'no application' }), { status: 404 }))
    )
    const { result } = renderHook(() => useAidApplication(1000003), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    renderHook(() => useAidApplication(0), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reads nothing without the financial_aid.view permission', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidApplication(1000001), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads nothing while its caller says it is not needed', async () => {
    renderHook(() => useAidApplication(1000001, { enabled: false }), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
