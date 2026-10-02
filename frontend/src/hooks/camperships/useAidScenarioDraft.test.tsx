/**
 * The scenario draft at work (spec §7.4; D37, D38; Decision 19). `useApiWithAuth` is NOT mocked:
 * every call reaches `fetch`, which answers by route, so the test reads the order of the calls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  results,
  scenarioDraft,
  workspace,
} from '../../components/camperships/season/scenarios/scenarioFixtures'
import type { ApiAidScenarioWorkspace } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useAidScenarioDraft } from './useAidScenarioDraft'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../useCurrentYear', () => ({ useYear: () => 2027 }))

const SAVED = scenarioDraft({ trail_id: 'trail0000000002', label: 'Round 1 % −6 pts' })
const LOADED = scenarioDraft({ trail_id: 'trail0000000003', from_code: 'A1' })
const EVALUATED = {
  document: { ...SAVED.document, year: 2027 },
  results: results(700000),
  report: { issues: [] },
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let calls: Array<{ route: string; body: unknown }>
let hold: Promise<void> | null

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function answer(route: string): Response {
  if (route === 'POST /api/financial-aid/scenarios/2027/evaluate') return json(EVALUATED)
  if (route === 'PUT /api/financial-aid/scenarios/2027/draft') return json(SAVED)
  if (route === 'POST /api/financial-aid/scenarios/2027/draft/load') return json(LOADED)
  if (route === 'POST /api/financial-aid/scenarios/2027/keep')
    return json({ detail: 'Your draft is the same as B: there is nothing new to keep' }, 409)
  return json({}, 404)
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.useFakeTimers()
  client = new QueryClient()
  client.setQueryData(queryKeys.aidScenarios(2027), workspace())
  calls = []
  hold = null
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`
    calls.push({ route, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (hold !== null && route.endsWith('/evaluate')) await hold
    return answer(route)
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const routes = () => calls.map((c) => c.route.replace('/api/financial-aid/scenarios/2027', ''))
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useAidScenarioDraft (Decision 19)', () => {
  it('follows a slider live, waiting for it to pause, and records nothing', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => {
      result.current.move({ tierShift: -1 })
      result.current.move({ tierShift: -2 })
    })
    expect(result.current.live).toEqual({ status: 'loading' })
    await flush(300)
    expect(routes()).toEqual(['POST /evaluate'])
    expect(calls[0]?.body).toMatchObject({ tier_shift: -2, band_width_delta: 0 })
    expect(result.current.live).toEqual({ status: 'ready', results: EVALUATED.results })
  })

  it('records a release: prices what moved, then saves the document the server returned', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1, minimum: '150' }))
    await act(() => result.current.release())
    expect(routes()).toEqual(['POST /evaluate', 'PUT /draft'])
    expect(calls[0]?.body).toMatchObject({
      tier_shift: -1,
      document: { awards: { minimum: '150' } },
    })
    expect(calls[1]?.body).toEqual({ document: EVALUATED.document })
    expect(result.current.pending).toEqual({
      tierShift: 0,
      bandDelta: 0,
      minimum: null,
      dollar: null,
    })
    expect(
      client.getQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(2027))?.draft
    ).toEqual(SAVED)
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['financial-aid', 'scenarios'] })
    )
  })

  it('records nothing when nothing moved', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(() => result.current.release())
    expect(calls).toEqual([])
  })

  it('runs a load clicked during a release after it, so the typing is recorded first', async () => {
    let open: () => void = () => undefined
    hold = new Promise<void>((resolve) => {
      open = resolve
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ minimum: '150' }))
    let releasing: Promise<boolean> = Promise.resolve(true)
    let loading: Promise<boolean> = Promise.resolve(true)
    act(() => {
      releasing = result.current.release()
      loading = result.current.load({ option: 'A1' })
    })
    await flush()
    expect(result.current.busy).toBe('Recording…')
    expect(routes()).toEqual(['POST /evaluate'])
    await act(async () => {
      open()
      await releasing
      await loading
    })
    expect(routes()).toEqual(['POST /evaluate', 'PUT /draft', 'POST /draft/load'])
    expect(calls[2]?.body).toEqual({ option: 'A1' })
    expect(result.current.busy).toBeNull()
  })

  it("says a refused write in the server's words, and keeps going", async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let landed = true
    await act(async () => {
      landed = await result.current.keep(false)
    })
    expect(landed).toBe(false)
    expect(result.current.error).toBe('Your draft is the same as B: there is nothing new to keep')
    expect(calls[0]?.body).toEqual({ starting_point: false })
  })
})
