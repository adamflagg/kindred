/**
 * The editor's preview (§4.6; D22): typing is debounced and never cached, and a stale answer never
 * wins. The amount an editor opens on (R2, owner ruling 10-05) is asked at once, and reused when the
 * card already prefetched it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidPreview } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useAidEditorPreview, usePrefetchAidPreview } from './useAidEditorPreview'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

const OUT: ApiAidPreview = {
  award: 780,
  trace: [],
  stage_after: 'needs_offer',
  stage_after_label: 'Needs an offer',
  shares: [],
  pending_approval: false,
}
const ok = (body: ApiAidPreview) => new Response(JSON.stringify(body), { status: 200 })
const householdOf = () => ({ chip: null, name: null })

let fetchSpy: MockInstance<typeof fetch>
let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.useFakeTimers()
  // The app's own cache defaults (utils/queryClient.ts): a 30-minute staleTime.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 60 * 1000 } } })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(ok(OUT)))
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useAidEditorPreview', () => {
  it('waits for typing to pause, then sends one POST through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf), {
      wrapper,
    })
    act(() => {
      result.current.onAmountChange(1)
      result.current.onAmountChange(13)
      result.current.onAmountChange(1300)
    })
    expect(result.current.preview).toEqual({ status: 'loading' })
    await advance(300)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/requests/reqolivia000003/preview')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ round: 2, amount: 1300 })
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(result.current.preview).toMatchObject({
      status: 'ready',
      award: 780,
      stageChange: 'Needs an offer',
    })
  })

  it('drops an older answer that arrives after a newer amount was typed', async () => {
    let answerFirst: ((response: Response) => void) | undefined
    fetchSpy
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerFirst = resolve
          })
      )
      .mockImplementationOnce(() => Promise.resolve(ok({ ...OUT, award: 900 })))
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf), {
      wrapper,
    })
    act(() => result.current.onAmountChange(1300))
    await advance(300)
    act(() => result.current.onAmountChange(1500))
    await advance(300)
    expect(result.current.preview).toMatchObject({ award: 900 })
    await act(async () => {
      answerFirst?.(ok(OUT))
      await Promise.resolve()
    })
    expect(result.current.preview).toMatchObject({ award: 900 })
  })

  it("shows the server's refusal as the editor's error", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "Round 2 is posted; its ask can't change" }), {
          status: 422,
        })
      )
    )
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf), {
      wrapper,
    })
    act(() => result.current.onAmountChange(1300))
    await advance(300)
    expect(result.current.preview).toEqual({
      status: 'error',
      error: "Round 2 is posted; its ask can't change",
    })
  })

  it('goes back to idle when the amount is cleared, asking nothing', async () => {
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf), {
      wrapper,
    })
    act(() => result.current.onAmountChange(null))
    await advance(300)
    expect(result.current.preview).toEqual({ status: 'idle' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('useAidEditorPreview: the amount an editor opens on (R2)', () => {
  const sentBodies = () =>
    fetchSpy.mock.calls.map(([, options]) => JSON.parse((options as RequestInit).body as string))

  it('asks at once, without waiting for the debounce', async () => {
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    // Never "Type an amount": the line is on its way from the first paint.
    expect(result.current.preview).toEqual({ status: 'loading' })
    await advance(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(sentBodies()).toEqual([{ round: 3, amount: 500 }])
    expect(result.current.preview).toMatchObject({ status: 'ready', award: 780 })
  })

  it('reuses what the card prefetched: ready at the first paint, and no second request', async () => {
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await advance(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    expect(result.current.preview).toMatchObject({ status: 'ready', award: 780 })
    await advance(300)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('joins a prefetch still on its way rather than asking twice', async () => {
    let answer: ((response: Response) => void) | undefined
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        })
    )
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await advance(0)
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    await advance(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await act(async () => {
      answer?.(ok({ ...OUT, award: 640 }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.preview).toMatchObject({ status: 'ready', award: 640 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('never reuses a prefetch for another amount or round', async () => {
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await advance(0)
    renderHook(() => useAidEditorPreview('reqolivia000003', 3, householdOf, 600), { wrapper })
    renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf, 500), { wrapper })
    await advance(0)
    expect(sentBodies()).toEqual([
      { round: 3, amount: 500 },
      { round: 3, amount: 600 },
      { round: 2, amount: 500 },
    ])
  })

  it('asks again once a write has refreshed the household page', async () => {
    const prefetch = renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), {
      wrapper,
    })
    await advance(0)
    prefetch.unmount()
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.aidHouseholdPagePrefix() })
    })
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    expect(result.current.preview).toEqual({ status: 'loading' })
    await advance(0)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('lets the card prefetch follow a write that refreshes the household page', async () => {
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await advance(0)
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.aidHouseholdPagePrefix() })
    })
    await advance(0)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('keeps a prefetch whose card remounted mid-read, rather than asking twice', async () => {
    let answer: ((response: Response) => void) | undefined
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        })
    )
    const first = renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await advance(0)
    first.unmount()
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, 500), { wrapper })
    await act(async () => {
      answer?.(ok(OUT))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prefetches nothing for a card whose editor opens empty', async () => {
    renderHook(() => usePrefetchAidPreview('reqolivia000003', 3, null), { wrapper })
    await advance(300)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets a typed amount win over the answer for the amount it opened on', async () => {
    let answerOpen: ((response: Response) => void) | undefined
    fetchSpy
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answerOpen = resolve
          })
      )
      .mockImplementationOnce(() => Promise.resolve(ok({ ...OUT, award: 900 })))
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    await advance(0)
    act(() => result.current.onAmountChange(600))
    await advance(300)
    expect(result.current.preview).toMatchObject({ award: 900 })
    await act(async () => {
      answerOpen?.(ok(OUT))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.preview).toMatchObject({ award: 900 })
  })

  it('still waits for typing to pause after opening', async () => {
    const { result } = renderHook(
      () => useAidEditorPreview('reqolivia000003', 3, householdOf, 500),
      { wrapper }
    )
    await advance(0)
    act(() => result.current.onAmountChange(600))
    await advance(299)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
