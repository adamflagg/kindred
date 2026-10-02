/** The scenario workspace and each setting's step (spec §7.4): through fetchWithAuth, `rules` only. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  scenarioDraft,
  workspace,
} from '../../components/camperships/season/scenarios/scenarioFixtures'
import {
  evaluateAidScenario,
  fetchAidScenarioSensitivity,
  freezeAidScenarioSeason,
  keepAidScenario,
  loadAidScenarioDraft,
  saveAidScenarioDraft,
  startAidScenarios,
} from '../../services/camperships/aidApi'
import { useAidScenarioSensitivity, useAidScenarios } from './useAidScenarios'

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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  granted = ['financial_aid.view', 'financial_aid.rules']
  authLoading = false
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(workspace()), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidScenarios (D38, D76)', () => {
  it('reads the workspace through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidScenarios(), { wrapper })
    await waitFor(() => expect(result.current.data?.rules_version).toBe(4))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/scenarios/2027')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('reads nothing without rules (D76 hides Scenarios)', async () => {
    granted = ['financial_aid.view']
    renderHook(() => useAidScenarios(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads nothing while auth is still loading', async () => {
    authLoading = true
    renderHook(() => useAidScenarios(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("answers the server's refusal (no rules yet) at once, without retrying", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'No rules for 2027' }), { status: 404 })
      )
    )
    const { result } = renderHook(() => useAidScenarios(), { wrapper })
    await waitFor(() => expect(result.current.error?.message).toBe('No rules for 2027'))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('useAidScenarioSensitivity (§7.4)', () => {
  it("POSTs the draft's document, and waits for a draft and a snapshot", async () => {
    renderHook(() => useAidScenarioSensitivity(null, workspace().snapshot), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
    renderHook(() => useAidScenarioSensitivity(scenarioDraft(), workspace().snapshot), { wrapper })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/scenarios/2027/sensitivity')
    expect(options.method).toBe('POST')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(JSON.parse(String(options.body))).toEqual({ document: scenarioDraft().document })
  })

  it('reads nothing without rules, whatever it was handed', async () => {
    granted = ['financial_aid.view']
    renderHook(() => useAidScenarioSensitivity(scenarioDraft(), workspace().snapshot), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads nothing while auth is still loading', async () => {
    authLoading = true
    renderHook(() => useAidScenarioSensitivity(scenarioDraft(), workspace().snapshot), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the request set (D138) with the document, as the server reads it', async () => {
    renderHook(
      () =>
        useAidScenarioSensitivity(scenarioDraft(), workspace().snapshot, {
          through_round1_deadline: true,
        }),
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toEqual({
      document: scenarioDraft().document,
      through_round1_deadline: true,
    })
  })

  it('waits for a snapshot too', async () => {
    renderHook(() => useAidScenarioSensitivity(scenarioDraft(), null), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the scenario writes (wire; every route is finance-only on the server)', () => {
  // The writes take fetchWithAuth, which is what attaches the bearer: assert the call shape they make.
  const calls: Array<[string, RequestInit | undefined]> = []
  const fetchWithAuth = (url: string, options?: RequestInit) => {
    calls.push([url, options])
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
  }
  beforeEach(() => {
    calls.length = 0
  })
  const last = () => calls[calls.length - 1] as [string, RequestInit]
  const doc = { document: scenarioDraft().document }

  it('freezes with a POST to /snapshot', async () => {
    await freezeAidScenarioSeason(fetchWithAuth, 2027)
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/snapshot')
    expect(last()[1].method).toBe('POST')
  })

  it('starts from the rules draft, or from last season at its own route', async () => {
    await startAidScenarios(fetchWithAuth, 2027, 'rules')
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/starting-points')
    await startAidScenarios(fetchWithAuth, 2027, 'last_season')
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/starting-points/last-season')
    expect(last()[1].method).toBe('POST')
  })

  it('evaluates by POST with the body and the abort signal', async () => {
    const controller = new AbortController()
    await evaluateAidScenario(fetchWithAuth, 2027, doc, controller.signal)
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/evaluate')
    expect(last()[1].method).toBe('POST')
    expect(last()[1].signal).toBe(controller.signal)
    expect(JSON.parse(String(last()[1].body))).toEqual(doc)
  })

  it("asks each setting's step by POST, the request set riding along", async () => {
    await fetchAidScenarioSensitivity(fetchWithAuth, 2027, {
      ...doc,
      received_through: '2026-04-01',
    })
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/sensitivity')
    expect(last()[1].method).toBe('POST')
    expect(JSON.parse(String(last()[1].body))).toEqual({ ...doc, received_through: '2026-04-01' })
  })

  it('saves the draft by PUT, and loads into it by POST', async () => {
    await saveAidScenarioDraft(fetchWithAuth, 2027, doc)
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/draft')
    expect(last()[1].method).toBe('PUT')
    await loadAidScenarioDraft(fetchWithAuth, 2027, { option: 'A' })
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/draft/load')
    expect(last()[1].method).toBe('POST')
    expect(JSON.parse(String(last()[1].body))).toEqual({ option: 'A' })
  })

  it('keeps by POST', async () => {
    await keepAidScenario(fetchWithAuth, 2027, { starting_point: true })
    expect(last()[0]).toBe('/api/financial-aid/scenarios/2027/keep')
    expect(JSON.parse(String(last()[1].body))).toEqual({ starting_point: true })
  })

  it("surfaces the server's words on a refusal, status kept", async () => {
    const refusing = () =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'No approved rules' }), { status: 422 })
      )
    await expect(startAidScenarios(refusing, 2027, 'last_season')).rejects.toMatchObject({
      status: 422,
    })
  })
})
