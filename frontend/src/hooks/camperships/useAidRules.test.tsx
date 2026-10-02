/**
 * The Rules tab's two reads (spec §7.5; D39, D76). `useApiWithAuth` is NOT mocked: the header
 * assertion reads what reaches the network. The client keeps the app's own retry rule, so the test
 * proves a 404 ("no rules yet") answers at once while a 500 is still retried.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { APPROVED_RULES, rulesDraft } from '../../components/camperships/season/rules/rulesFixtures'
import { useAidApprovedRules, useAidRulesDraft } from './useAidRules'

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

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  // retryDelay 0 so a retried call shows up within the test; the retry count is the hook's own.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  granted = ['financial_aid.view']
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok(APPROVED_RULES))
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidApprovedRules (D76)', () => {
  it('reads the approved rules through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidApprovedRules(null), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(APPROVED_RULES))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/rules/2027/approved')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("asks for a receipt's version", async () => {
    renderHook(() => useAidApprovedRules(2), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(
      '/api/financial-aid/rules/2027/approved?version=2'
    )
  })

  it('answers "none approved yet" (404) at once, without retrying', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: '2027 has no approved rules yet' }), { status: 404 })
      )
    )
    const { result } = renderHook(() => useAidApprovedRules(null), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('still retries a server fault', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response('', { status: 500 })))
    const { result } = renderHook(() => useAidApprovedRules(null), { wrapper })
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })
})

describe('useAidRulesDraft (D39)', () => {
  it('reads the rules draft for `rules` holders only', async () => {
    renderHook(() => useAidRulesDraft(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
    granted = ['financial_aid.view', 'financial_aid.rules']
    fetchSpy.mockImplementation(() => ok(rulesDraft()))
    const { result } = renderHook(() => useAidRulesDraft(), { wrapper })
    await waitFor(() => expect(result.current.data?.version).toBe(4))
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe('/api/financial-aid/rules/2027/draft')
  })
})
