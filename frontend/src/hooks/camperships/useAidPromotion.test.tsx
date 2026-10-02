/** Fit to budget and "Make it the rules draft": through fetchWithAuth, and what each refreshes (D39). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { RULES_DOCUMENT, rulesDraft } from '../../components/camperships/season/rules/rulesFixtures'
import { queryKeys } from '../../utils/queryKeys'
import { useAidMakeRulesDraft, useAidPromotionPreview, useAidScenarioFit } from './useAidPromotion'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(rulesDraft()), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const sent = (index = 0) => {
  const [url, options] = fetchSpy.mock.calls[index] as [string, RequestInit]
  return {
    url,
    method: options.method ?? 'GET',
    body: options.body ? (JSON.parse(String(options.body)) as unknown) : null,
    auth: new Headers(options.headers).get('Authorization'),
  }
}

describe('useAidScenarioFit (D119)', () => {
  it("POSTs the draft's document and refreshes nothing: it records nothing", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidScenarioFit(), { wrapper })
    await act(() => result.current.mutateAsync(RULES_DOCUMENT))
    expect(sent()).toEqual({
      url: '/api/financial-aid/scenarios/2027/fit-to-budget',
      method: 'POST',
      body: { document: RULES_DOCUMENT },
      auth: 'Bearer test-jwt',
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useAidPromotionPreview (D39)', () => {
  it("reads what the option would change, only once there's an option to look at", async () => {
    renderHook(() => useAidPromotionPreview(null), { wrapper })
    renderHook(() => useAidPromotionPreview('A1'), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(sent().url).toBe('/api/financial-aid/scenarios/2027/options/A1/rules-draft')
    expect(sent().auth).toBe('Bearer test-jwt')
  })

  it('is keyed under the scenario prefix, so a rules write refreshes it', () => {
    expect(queryKeys.aidPromotionPreview(2027, 'A1').slice(0, 2)).toEqual(
      queryKeys.aidScenariosPrefix()
    )
    // Never at index 3 === 'sensitivity': every refresh skips that slot.
    expect(queryKeys.aidPromotionPreview(2027, 'A1')[3]).not.toBe('sensitivity')
  })
})

describe('useAidMakeRulesDraft (D39)', () => {
  it('POSTs the preview’s version and the confirmed tokens, and refreshes the rules but no money', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidMakeRulesDraft(), { wrapper })
    const body = { base_version: 4, acknowledged: { award_tables: 'tok-1' } }
    await act(() => result.current.mutateAsync({ code: 'A1', body }))
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/scenarios/2027/options/A1/rules-draft',
      method: 'POST',
      body,
      auth: 'Bearer test-jwt',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.aidRulesPrefix() })
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['financial-aid', 'scenarios'] })
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.aidHistoryPrefix() })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.aidBudgetPrefix() })
  })
})
