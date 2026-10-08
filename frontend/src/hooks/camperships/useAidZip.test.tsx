/** useAidZip: ZIP codes' one read (spec §9.4; D90; owner ruling C). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { ZIP } from '../../components/camperships/reports/zipFixtures'
import { useAidZip } from './useAidZip'

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

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.summary']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(ZIP), { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidZip', () => {
  it("asks for the server's default group when the link names none, with summary alone (D65)", async () => {
    const { result } = renderHook(() => useAidZip(null), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(ZIP))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/development/zip')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('sends the group the chip names', async () => {
    renderHook(() => useAidZip('all'), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/financial-aid/reports/2027/development/zip?group=all'
    )
  })
})
