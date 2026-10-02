/**
 * useAidBudget: Rounds & budget's one read (spec §7.2; D21). `useApiWithAuth` is NOT mocked: the
 * header assertion reads what reaches the network (frontend/CLAUDE.md "Auth").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { BUDGET } from '../../components/camperships/season/budgetFixtures'
import { useAidBudget } from './useAidBudget'

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
let route = '/aid/season/rounds-budget'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view']
  route = '/aid/season/rounds-budget'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(BUDGET), { status: 200 }))
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidBudget', () => {
  it('reads Rounds & budget through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidBudget(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BUDGET))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/budget')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("asks for the page's past day, on its axis", async () => {
    route = '/aid/season/rounds-budget?as_of=2027-03-15&as_of_axis=recorded'
    renderHook(() => useAidBudget(), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      '/api/financial-aid/decisions/2027/budget?as_of=2027-03-15&as_of_axis=recorded'
    )
  })

  it('reads nothing without view, or when the page turns it off', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidBudget(), { wrapper })
    granted = ['financial_aid.view']
    renderHook(() => useAidBudget({ enabled: false }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
