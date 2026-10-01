/**
 * useAidGrid: the Requests grid's one read (§6.1, D21). `useApiWithAuth` is NOT mocked: the header
 * assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { ROW_EMMA } from '../../components/camperships/requests/gridFixtures'
import type { ApiAidGrid } from '../../types/api-types'
import { useAidGrid } from './useAidGrid'

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

const PAYLOAD: ApiAidGrid = { year: 2027, rules_version: 1, rows: [ROW_EMMA] }

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let route = '/aid/requests'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  year = 2027
  route = '/aid/requests'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

describe('useAidGrid', () => {
  it('sends the protected read through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidGrid(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(PAYLOAD))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/grid')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('asks for the past day a link names', async () => {
    route = '/aid/requests?as_of=2026-04-01'
    renderHook(() => useAidGrid(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/financial-aid/decisions/2027/grid?as_of=2026-04-01'
    )
  })

  it('reads live when asked to, whatever the link says (the household page, Decision 36)', async () => {
    route = '/aid/households/1000001?as_of=2026-04-01'
    renderHook(() => useAidGrid({ live: true }), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/financial-aid/decisions/2027/grid')
  })

  it('waits for a season, a view permission, and being enabled', async () => {
    year = 0
    renderHook(() => useAidGrid(), { wrapper })
    year = 2027
    granted = ['financial_aid.summary']
    renderHook(() => useAidGrid(), { wrapper })
    granted = ['financial_aid.view']
    renderHook(() => useAidGrid({ enabled: false }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
