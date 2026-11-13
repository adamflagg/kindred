/**
 * Form intake's adult aid form reads and writes (adult aid form design §5, §10; PR 3): Link…'s own read, Link…,
 * Ignore…, Mark Reviewed on a changed form and Pull Now. Each goes through fetchWithAuth and every write refreshes
 * Form intake, Today, the household page and Requests. Pull Now only starts the read (202), so the list refreshes
 * again once it can have landed. `useApiWithAuth` is NOT mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  PULL_REFRESH_MS,
  useAidIgnoreResponse,
  useAidLinkCandidates,
  useAidLinkResponse,
  useAidPullForm,
  useAidReviewFormChange,
} from './useAidFormResponses'

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
const BODY = { id: 'rec1', response_id: 'resp-1', candidates: [] }
const MOVED = [
  ['financial-aid', 'intake'],
  ['financial-aid', 'grid'],
  ['financial-aid', 'household-page'],
  ['financial-aid', 'today'],
]

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  granted = ['financial_aid.view', 'financial_aid.casework']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(BODY), { status: 200 })))
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const lastCall = () => fetchSpy.mock.calls.at(-1) as [string, RequestInit]

describe("Link…'s own read", () => {
  it('reads the candidates of the opened response through fetchWithAuth', async () => {
    const { result } = renderHook(() => useAidLinkCandidates('rec1'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BODY))
    expect(lastCall()[0]).toBe('/api/financial-aid/intake/2027/form-responses/rec1/candidates')
    expect(new Headers(lastCall()[1].headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('searches someone else by the typed words', async () => {
    const { result } = renderHook(() => useAidLinkCandidates('rec1', ' Sam Lee '), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BODY))
    expect(lastCall()[0]).toBe(
      '/api/financial-aid/intake/2027/form-responses/rec1/candidates?q=Sam+Lee'
    )
  })

  it('reads nothing while no response is open, or without casework', async () => {
    renderHook(() => useAidLinkCandidates(null), { wrapper })
    granted = ['financial_aid.view']
    renderHook(() => useAidLinkCandidates('rec1'), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the writes refresh every read they move', () => {
  it('Link… posts the person', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidLinkResponse(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027, id: 'rec1', personCmId: 1000111 }))
    expect(lastCall()[0]).toBe('/api/financial-aid/intake/2027/form-responses/rec1/link')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ person_cm_id: 1000111 })
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
    // A household may gain aid activity: the jump box's index too.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'jump-index'] })
  })

  it('Ignore… posts the kind and the reason', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidIgnoreResponse(), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        year: 2027,
        id: 'rec1',
        body: { kind: 'test', reason: 'A test entry' },
      })
    )
    expect(lastCall()[0]).toBe('/api/financial-aid/intake/2027/form-responses/rec1/ignore')
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      kind: 'test',
      reason: 'A test entry',
    })
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })

  it('Mark Reviewed on a changed form posts the request', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidReviewFormChange(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027, requestId: 'req1' }))
    expect(lastCall()[0]).toBe('/api/financial-aid/requests/2027/form-changes/req1/review')
    expect(lastCall()[1].method).toBe('POST')
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })
})

describe('Pull Now', () => {
  it('starts the read, then refreshes Form intake and Today again once it can have landed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'started' }), { status: 202 }))
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidPullForm(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027 }))
    expect(lastCall()[0]).toBe('/api/financial-aid/intake/2027/form-responses/pull')
    expect(lastCall()[1].method).toBe('POST')
    await waitFor(() => expect(result.current.data).toEqual({ status: 'started' }))
    invalidate.mockClear()
    for (const ms of PULL_REFRESH_MS) {
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }
    const intake = invalidate.mock.calls.filter(
      ([f]) => JSON.stringify(f) === JSON.stringify({ queryKey: ['financial-aid', 'intake'] })
    )
    expect(intake).toHaveLength(PULL_REFRESH_MS.length)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'today'] })
    // The landed pull rebuilds the season's requests, so every aid read refreshes as a write's does: the household
    // page's adult answer sets and the Requests grid too.
    const household = invalidate.mock.calls.filter(
      ([f]) =>
        JSON.stringify(f) === JSON.stringify({ queryKey: ['financial-aid', 'household-page'] })
    )
    expect(household).toHaveLength(PULL_REFRESH_MS.length)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grid'] })
  })

  it('stops refreshing once the page is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'started' }), { status: 202 }))
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result, unmount } = renderHook(() => useAidPullForm(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027 }))
    invalidate.mockClear()
    unmount()
    vi.advanceTimersByTime(PULL_REFRESH_MS.reduce((a, b) => a + b, 0))
    expect(invalidate).not.toHaveBeenCalled()
  })
})
