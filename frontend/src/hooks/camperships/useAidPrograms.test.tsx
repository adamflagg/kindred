/** useAidPrograms: Reports › Programs' one read (spec §9.3; RPT-11). `useApiWithAuth` is NOT mocked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { PROGRAMS } from '../../components/camperships/reports/programsFixtures'
import { useAidPrograms } from './useAidPrograms'

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
let path = '/aid/reports/programs'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.view']
  path = '/aid/reports/programs'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PROGRAMS), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidPrograms', () => {
  it('reads the season through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidPrograms({ kind: 'all' }), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(PROGRAMS))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/reports/2027/programs')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('sends the request set and the past date', async () => {
    path = '/aid/reports/programs?as_of=2027-03-08'
    renderHook(() => useAidPrograms({ kind: 'date', date: '2027-02-01' }), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      '/api/financial-aid/reports/2027/programs?received_through=2027-02-01&as_of=2027-03-08'
    )
  })

  it('reads nothing without view', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidPrograms({ kind: 'all' }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
