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
import { RULES_DOCUMENT } from '../../components/camperships/season/rules/rulesFixtures'
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
const STARTED = workspace({ draft: scenarioDraft({ trail_id: 'trail0000000009', from_code: 'A' }) })
const EVALUATED = {
  document: { ...SAVED.document, year: 2027 },
  results: results(700000),
  report: { issues: [] },
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
let calls: Array<{ route: string; body: unknown; headers: Headers }>
let hold: Promise<void> | null
/** What `PUT /draft` answers: the server's saved draft (a test may make it differ from the workspace's). */
let saved = SAVED

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function answer(route: string): Response {
  if (route === 'POST /api/financial-aid/scenarios/2027/evaluate') return json(EVALUATED)
  if (route === 'PUT /api/financial-aid/scenarios/2027/draft') return json(saved)
  if (route === 'POST /api/financial-aid/scenarios/2027/draft/load') return json(LOADED)
  if (route === 'POST /api/financial-aid/scenarios/2027/snapshot') return json({})
  if (route.startsWith('POST /api/financial-aid/scenarios/2027/starting-points'))
    return json(STARTED)
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
  saved = SAVED
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const route = `${init?.method ?? 'GET'} ${String(input)}`
    calls.push({
      route,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    })
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
    expect(result.current.busy).toBeNull()
    await act(async () => {
      landed = await result.current.load({ option: 'A1' })
    })
    expect(landed).toBe(true)
    expect(result.current.error).toBeNull()
    expect(routes()).toEqual(['POST /keep', 'POST /draft/load'])
  })

  it('keeps a refusal on screen through a release with nothing to record (T17-m6)', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(async () => {
      await result.current.keep(false)
    })
    const busySeen: Array<string | null> = []
    await act(async () => {
      const releasing = result.current.release()
      busySeen.push(result.current.busy)
      await releasing
    })
    expect(result.current.error).toBe('Your draft is the same as B: there is nothing new to keep')
    expect(busySeen).toEqual([null])
    expect(result.current.busy).toBeNull()
    expect(routes()).toEqual(['POST /keep'])
  })

  it("says so when a freeze finds the season hasn't moved: the server hands back the same snapshot (F-m7)", async () => {
    const same = workspace().snapshot
    fetchSpy.mockImplementation(async (input, init) => {
      const route = `${init?.method ?? 'GET'} ${String(input)}`
      calls.push({ route, body: null, headers: new Headers(init?.headers) })
      return route.endsWith('/snapshot') ? json(same) : answer(route)
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(() => result.current.freeze())
    expect(result.current.nothingToFreeze).toBe(true)
    // The next write that runs clears it, as it clears an error.
    await act(() => result.current.load({ option: 'A1' }))
    expect(result.current.nothingToFreeze).toBe(false)
  })

  it('says nothing more when a freeze writes a new snapshot (F-m7)', async () => {
    fetchSpy.mockImplementation(async (input, init) => {
      const route = `${init?.method ?? 'GET'} ${String(input)}`
      calls.push({ route, body: null, headers: new Headers(init?.headers) })
      return route.endsWith('/snapshot')
        ? json({ ...workspace().snapshot, id: 'snap00000000002' })
        : answer(route)
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(() => result.current.freeze())
    expect(result.current.nothingToFreeze).toBe(false)
  })

  it('records nothing for a minimum typed back to the stored amount, by value (scan #1)', async () => {
    const stored = workspace({
      draft: scenarioDraft({
        document: { ...RULES_DOCUMENT, awards: { ...RULES_DOCUMENT.awards, minimum: '250.00' } },
      }),
    })
    const { result } = renderHook(() => useAidScenarioDraft(stored), { wrapper })
    act(() => result.current.move({ minimum: '250' }))
    expect(result.current.pending.minimum).toBeNull()
    expect(result.current.live).toEqual({ status: 'idle' })
    await act(() => result.current.release())
    expect(calls).toEqual([])
  })

  it('records nothing for the switch toggled back to where it was (scan #1)', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ dollar: false }))
    act(() => result.current.move({ dollar: true }))
    expect(result.current.pending.dollar).toBeNull()
    await act(() => result.current.release())
    expect(calls).toEqual([])
  })

  it('records nothing for a slider dragged back to zero (scan #1)', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1, bandDelta: 500 }))
    act(() => result.current.move({ tierShift: 0, bandDelta: 0 }))
    await act(() => result.current.release())
    await flush(300)
    expect(calls).toEqual([])
  })

  it('sends every call through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1 }))
    await act(() => result.current.release())
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.headers.get('Authorization')).toBe('Bearer test-jwt')
  })

  it('keeps the newest live answer when an older one arrives late', async () => {
    let openFirst: () => void = () => undefined
    const first = new Promise<void>((resolve) => {
      openFirst = resolve
    })
    let seen = 0
    fetchSpy.mockImplementation(async () => {
      seen += 1
      if (seen === 1) {
        await first
        return json({ ...EVALUATED, results: results(1) })
      }
      return json({ ...EVALUATED, results: results(2) })
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1 }))
    await flush(300)
    act(() => result.current.move({ tierShift: -2 }))
    await flush(300)
    expect(result.current.live).toEqual({ status: 'ready', results: results(2) })
    await act(async () => {
      openFirst()
      await first
    })
    await flush()
    expect(result.current.live).toEqual({ status: 'ready', results: results(2) })
  })

  it('waits for the refresh to land before a write reports done', async () => {
    let land: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      land = resolve
    })
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(held)
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let done = false
    let freezing: Promise<boolean> = Promise.resolve(false)
    act(() => {
      freezing = result.current.freeze().then((landed) => {
        done = true
        return landed
      })
    })
    await flush()
    expect(routes()).toEqual(['POST /snapshot'])
    expect(calls[0]?.body).toEqual({})
    expect(result.current.busy).toBe('Freezing the applications…')
    expect(done).toBe(false)
    await act(async () => {
      land()
      await freezing
    })
    expect(done).toBe(true)
    expect(result.current.busy).toBeNull()
  })

  it('does not let a failing refresh stop later writes', async () => {
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('refetch failed'))
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(async () => {
      await result.current.freeze()
    })
    let landed = false
    await act(async () => {
      landed = await result.current.load({ option: 'A1' })
    })
    expect(landed).toBe(true)
    expect(routes()).toEqual(['POST /snapshot', 'POST /draft/load'])
  })

  it('refreshes nothing when a release has nothing to record', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(() => result.current.release())
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('prices a release once: its own evaluate replaces the pending live one', async () => {
    let open: () => void = () => undefined
    hold = new Promise<void>((resolve) => {
      open = resolve
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let releasing: Promise<boolean> = Promise.resolve(true)
    act(() => {
      result.current.move({ tierShift: -1 })
      releasing = result.current.release()
    })
    await flush(300)
    expect(routes()).toEqual(['POST /evaluate'])
    await act(async () => {
      open()
      await releasing
    })
    expect(routes()).toEqual(['POST /evaluate', 'PUT /draft'])
  })

  it('resumes the live figures when a release is refused and moves are still on screen', async () => {
    fetchSpy.mockImplementation(async (input, init) => {
      const route = `${init?.method ?? 'GET'} ${String(input)}`
      calls.push({ route, body: null, headers: new Headers(init?.headers) })
      if (route.startsWith('PUT')) return json({ detail: 'The minimum is too high' }, 422)
      return json(EVALUATED)
    })
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ minimum: '900' }))
    await act(() => result.current.release())
    expect(result.current.error).toBe('The minimum is too high')
    expect(result.current.pending.minimum).toBe('900')
    expect(result.current.live).toEqual({ status: 'loading' })
    await flush(300)
    expect(result.current.live).toEqual({ status: 'ready', results: EVALUATED.results })
  })

  it('says so, and returns false, when moves have no draft to land in', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace({ draft: null })), {
      wrapper,
    })
    act(() => result.current.move({ tierShift: -1 }))
    let landed = true
    await act(async () => {
      landed = await result.current.release()
    })
    expect(landed).toBe(false)
    expect(result.current.error).toBe('Load a kept option into your draft first')
    expect(calls).toEqual([])
  })

  it('puts a loaded draft into the workspace and lets go of what moved', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1 }))
    await act(() => result.current.load({ trail_row: 'trail0000000003' }))
    expect(
      client.getQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(2027))?.draft
    ).toEqual(LOADED)
    expect(result.current.pending).toEqual({
      tierShift: 0,
      bandDelta: 0,
      minimum: null,
      dollar: null,
    })
    expect(result.current.live).toEqual({ status: 'idle' })
  })

  it('puts the workspace a start returns into the cache and lets go of what moved', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1 }))
    await act(() => result.current.start('last_season'))
    expect(routes()).toContain('POST /starting-points/last-season')
    expect(client.getQueryData(queryKeys.aidScenarios(2027))).toEqual(STARTED)
    expect(result.current.pending.tierShift).toBe(0)
    expect(result.current.live).toEqual({ status: 'idle' })
  })

  it('starts from the rules draft', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace({ draft: null })), {
      wrapper,
    })
    await act(() => result.current.start('rules'))
    expect(routes()).toEqual(['POST /starting-points'])
    expect(calls[0]?.body).toEqual({})
  })

  it('prices the live figures again on the new snapshot after a freeze', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ tierShift: -1 }))
    await flush(300)
    await act(() => result.current.freeze())
    expect(result.current.live).toEqual({ status: 'loading' })
    await flush(300)
    expect(routes()).toEqual(['POST /evaluate', 'POST /snapshot', 'POST /evaluate'])
    expect(result.current.live.status).toBe('ready')
  })
})

describe('adopt (PR 6: Fit to budget, All settings)', () => {
  it('records the document the builder returns as the draft', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let landed = false
    await act(async () => {
      landed = await result.current.adopt('Recording…', () => EVALUATED.document)
    })
    expect(landed).toBe(true)
    expect(routes()).toEqual(['PUT /draft'])
    expect(calls[0]?.body).toEqual({ document: EVALUATED.document })
  })

  it('builds on the draft as it stands when its turn comes: after a queued release', async () => {
    // The release records a draft that differs from the one the page was rendered with.
    saved = {
      ...SAVED,
      document: { ...SAVED.document, awards: { ...SAVED.document.awards, minimum: '150' } },
    }
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    act(() => result.current.move({ minimum: '150' }))
    const seen: unknown[] = []
    let adopted: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      void result.current.release()
      adopted = result.current.adopt('Recording…', (current) => {
        seen.push(current)
        return { ...current, year: 2099 }
      })
      // Queued behind the release: nothing is built at click time.
      expect(seen).toEqual([])
      await adopted
    })
    expect(routes()).toEqual(['POST /evaluate', 'PUT /draft', 'PUT /draft'])
    // It saw what the release recorded (the server's saved draft), not the draft it was clicked on.
    expect(seen).toEqual([saved.document])
    expect(calls[2]?.body).toEqual({ document: { ...saved.document, year: 2099 } })
  })

  it('records nothing when the draft moved on since the document was made (basedOn)', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let landed = true
    await act(async () => {
      landed = await result.current.adopt('Recording…', (current) => current, {
        basedOn: 'trail-from-before',
      })
    })
    expect(landed).toBe(false)
    expect(calls).toEqual([])
    expect(result.current.error).toBe('The draft moved since: try again')
  })

  it('records it when the draft is still the one it was made on', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    let landed = false
    await act(async () => {
      landed = await result.current.adopt('Recording…', () => EVALUATED.document, {
        basedOn: workspace().draft?.trail_id ?? '',
      })
    })
    expect(landed).toBe(true)
    expect(routes()).toEqual(['PUT /draft'])
  })

  it('says which write an error came from, so a section editor can own its refusal', async () => {
    const { result } = renderHook(() => useAidScenarioDraft(workspace()), { wrapper })
    await act(async () => {
      await result.current.adopt('Recording…', (current) => current, {
        basedOn: 'trail-from-before',
        source: 'awards',
      })
    })
    expect(result.current.error).toBe('The draft moved since: try again')
    expect(result.current.errorSource).toBe('awards')
    // The next write clears it with the error; a refusal with no source carries none.
    await act(async () => {
      await result.current.adopt('Recording…', (current) => current, { basedOn: 'again' })
    })
    expect(result.current.error).toBe('The draft moved since: try again')
    expect(result.current.errorSource).toBeNull()
  })
})
