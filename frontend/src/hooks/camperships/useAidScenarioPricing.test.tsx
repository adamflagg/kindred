import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { results } from '../../components/camperships/season/scenarios/scenarioFixtures'
import { queryKeys } from '../../utils/queryKeys'
import { documentKey, useAidScenarioPricing } from './useAidScenarioPricing'

const fetchWithAuth = vi.fn()
vi.mock('../useApiWithAuth', () => ({ useApiWithAuth: () => ({ fetchWithAuth }) }))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false }) }))
vi.mock('../usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))

const DOC = { year: 2027, awards: { minimum: '100' } } as never

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useAidScenarioPricing (§S5 E: the strip prices on evaluate, cached by document, snapshot and request set)', () => {
  beforeEach(() => {
    fetchWithAuth.mockReset()
    fetchWithAuth.mockResolvedValue(
      new Response(
        JSON.stringify({ document: DOC, results: results(700000), report: { issues: [] } })
      )
    )
  })

  it('evaluates the document on the request set and keys the answer by all three', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useAidScenarioPricing(DOC, { kind: 'deadline' }, 'snp000000000001'),
      { wrapper: wrapper(client) }
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    const [url, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/scenarios/2027/evaluate')
    expect(JSON.parse(String(init.body))).toEqual({ document: DOC, through_round1_deadline: true })
    const key = queryKeys.aidScenarioEvaluate(2027, 'snp000000000001', 'deadline', documentKey(DOC))
    expect(client.getQueryData(key)).toBeDefined()
  })

  // Owner, 2026-10-10: Posted ▾ prices every request as if nothing were posted; its answer is keyed apart.
  it('prices as if nothing is posted when asked, and keys that answer apart from the regular one', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useAidScenarioPricing(DOC, { kind: 'all' }, 'snp000000000001', true),
      { wrapper: wrapper(client) }
    )
    await waitFor(() => expect(result.current.data).toBeDefined())
    const [, init] = fetchWithAuth.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ document: DOC, as_if_unposted: true })
    const fresh = queryKeys.aidScenarioEvaluate(
      2027,
      'snp000000000001',
      'all:unposted',
      documentKey(DOC)
    )
    const regular = queryKeys.aidScenarioEvaluate(2027, 'snp000000000001', 'all', documentKey(DOC))
    expect(client.getQueryData(fresh)).toBeDefined()
    expect(client.getQueryData(regular)).toBeUndefined()
  })

  it('asks nothing without a document or a held pile', () => {
    const client = new QueryClient()
    renderHook(() => useAidScenarioPricing(null, { kind: 'all' }, 'snp000000000001'), {
      wrapper: wrapper(client),
    })
    renderHook(() => useAidScenarioPricing(DOC, { kind: 'all' }, null), {
      wrapper: wrapper(client),
    })
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })

  it('keys equal documents alike and different ones apart', () => {
    expect(documentKey({ a: 1, b: [2] })).toBe(documentKey({ a: 1, b: [2] }))
    expect(documentKey({ a: 1 })).not.toBe(documentKey({ a: 2 }))
  })
})
