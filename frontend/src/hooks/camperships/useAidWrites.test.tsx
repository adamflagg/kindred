/** Camperships writes: through fetchWithAuth, and every read they can move refreshed on settle. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useAidKeyAsk, useAidTickAccepted, useAidTickPosted } from './useAidWrites'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

const WROTE = { year: 2027, written: 1, unchanged: 0, operation_id: 'op0000000000001' }
const ASK = {
  requestId: 'reqolivia000003',
  body: { round: 2 as const, amount: 1300, asked_on: '2027-04-09', note: 'Family emailed (Apr 9)' },
}

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(WROTE), { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

describe('useAidKeyAsk', () => {
  it('posts the ask through fetchWithAuth, and refreshes every read it can move', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidKeyAsk(), { wrapper })
    await act(() => result.current.mutateAsync(ASK))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/requests/reqolivia000003/asks')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual(ASK.body)
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grid'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'household-page'] })
  })

  it('refreshes even when the write is refused: the data may have moved under the person', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Round 2 is posted' }), { status: 422 })
      )
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidKeyAsk(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(ASK)).rejects.toThrow('Round 2 is posted')
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grid'] })
  })

  it('resolves the save only after the reads it moved have refreshed (build ruling 1)', async () => {
    const finishers: Array<() => void> = []
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve)
        })
    )
    const { result } = renderHook(() => useAidKeyAsk(), { wrapper })
    let saved = false
    await act(async () => {
      void result.current.mutateAsync(ASK).then(() => {
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

describe('useAidTickPosted', () => {
  it('posts the rows to the season and refreshes the reads', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidTickPosted(), { wrapper })
    const body = { rows: [{ request_id: 'reqemma00000001', round: 1 as const, amount: 1420 }] }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/posted')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual(body)
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'remaining'] })
  })
})

describe('useAidTickAccepted', () => {
  it('posts the accepted ticks through fetchWithAuth, and refreshes the reads', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidTickAccepted(), { wrapper })
    const body = { rows: [{ request_id: 'reqsamuel000005', round: 1 as const }], accepted: true }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/decisions/2027/accepted')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual(body)
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grid'] })
  })
})
