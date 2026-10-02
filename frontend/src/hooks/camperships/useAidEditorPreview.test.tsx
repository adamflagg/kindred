/** The editor's preview (§4.6; D22): debounced, never cached, and a stale answer never wins. */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidPreview } from '../../types/api-types'
import { useAidEditorPreview } from './useAidEditorPreview'

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

beforeEach(() => {
  vi.useFakeTimers()
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
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf))
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
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf))
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
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf))
    act(() => result.current.onAmountChange(1300))
    await advance(300)
    expect(result.current.preview).toEqual({
      status: 'error',
      error: "Round 2 is posted; its ask can't change",
    })
  })

  it('goes back to idle when the amount is cleared, asking nothing', async () => {
    const { result } = renderHook(() => useAidEditorPreview('reqolivia000003', 2, householdOf))
    act(() => result.current.onAmountChange(null))
    await advance(300)
    expect(result.current.preview).toEqual({ status: 'idle' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
