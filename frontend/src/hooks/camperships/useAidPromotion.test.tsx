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
let authLoading = false
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: authLoading, user: { id: 'u1' } }),
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
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  granted = ['financial_aid.view', 'financial_aid.rules']
  authLoading = false
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
    await act(() => result.current.mutateAsync({ document: RULES_DOCUMENT, asIfUnposted: false }))
    expect(sent()).toEqual({
      url: '/api/financial-aid/scenarios/2027/fit-to-budget',
      method: 'POST',
      body: { document: RULES_DOCUMENT },
      auth: 'Bearer test-jwt',
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  // Owner, 2026-10-10: "as if nothing posted - all, regular - unposted".
  it('fits across every request when priced as if nothing is posted', async () => {
    const { result } = renderHook(() => useAidScenarioFit(), { wrapper })
    await act(() => result.current.mutateAsync({ document: RULES_DOCUMENT, asIfUnposted: true }))
    expect(sent().body).toEqual({ document: RULES_DOCUMENT, as_if_unposted: true })
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

  it('waits for auth and for the rules permission, like the other scenario reads', async () => {
    granted = ['financial_aid.view']
    renderHook(() => useAidPromotionPreview('A1'), { wrapper })
    authLoading = true
    granted = ['financial_aid.rules']
    renderHook(() => useAidPromotionPreview('A1'), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("answers a refusal in the server's words at once, and retries anything else", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'No such option' }), { status: 404 }))
    )
    const refused = renderHook(() => useAidPromotionPreview('A1'), { wrapper })
    await waitFor(() => expect(refused.result.current.isError).toBe(true))
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockClear()
    fetchSpy.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 500 })))
    const retried = renderHook(() => useAidPromotionPreview('B2'), { wrapper })
    await waitFor(() => expect(retried.result.current.isSuccess).toBe(true))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
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

  it('still refreshes when the draft moved on (409): the preview and rules are stale then', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'The rules draft moved on' }), { status: 409 })
      )
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidMakeRulesDraft(), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ code: 'A1', body: { base_version: 3 } })
      ).rejects.toThrow('The rules draft moved on')
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.aidRulesPrefix() })
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['financial-aid', 'scenarios'] })
    )
  })

  it('resolves only after the reads it moved have refreshed', async () => {
    const finishers: Array<() => void> = []
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve)
        })
    )
    const { result } = renderHook(() => useAidMakeRulesDraft(), { wrapper })
    let saved = false
    await act(async () => {
      void result.current.mutateAsync({ code: 'A1', body: { base_version: 4 } }).then(() => {
        saved = true
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(saved).toBe(false)
    await act(async () => {
      for (const finish of finishers) finish()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(saved).toBe(true)
  })
})
