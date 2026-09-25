/**
 * useJotformAdmin (kindred#2759) — the hook-level contract the service test
 * cannot see: every Jotform endpoint is `bunking.manage`-only, so the reads
 * and writes must reach the network carrying the PocketBase JWT, and a staff
 * link must refresh both the admin tab AND the weekend roster whose
 * bunking_request marks it moves.
 *
 * `useApiWithAuth` is deliberately NOT mocked: the header assertion reads what
 * reaches `fetch`, the only thing that proves the JWT (localStorage, not a
 * cookie) travels.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { queryKeys } from '../utils/queryKeys'
import { useJotformForms, useJotformQueue, useJotformSubmissionAction } from './useJotformAdmin'

vi.mock('../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

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
      Promise.resolve(new Response(JSON.stringify({ year: 2026, rows: [] }), { status: 200 }))
    )
})

afterEach(() => {
  fetchSpy.mockRestore()
})

function authHeaderOf(call: unknown[] | undefined): string | null {
  const init = (call?.[1] ?? {}) as RequestInit
  return new Headers(init.headers).get('Authorization')
}

describe('useJotformAdmin', () => {
  it('sends the forms and queue reads with the PocketBase JWT', async () => {
    renderHook(
      () => {
        useJotformForms(2026)
        useJotformQueue(2026)
      },
      { wrapper }
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    const urls = fetchSpy.mock.calls.map((call) => String(call[0])).sort()
    expect(urls).toEqual(['/api/jotform/forms?year=2026', '/api/jotform/queue?year=2026'])
    for (const call of fetchSpy.mock.calls) {
      expect(authHeaderOf(call)).toBe('Bearer test-jwt')
    }
  })

  it('reads nothing before the year is known', async () => {
    renderHook(() => useJotformForms(0), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('links with the JWT, then refreshes the Jotform tab and the weekend roster', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    result.current.mutate({
      kind: 'link',
      submissionId: '6600000000000000001',
      personCmId: 1000005,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/jotform/submissions/6600000000000000001/link')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-jwt')

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toContainEqual(queryKeys.jotformPrefix())
    expect(keys).toContainEqual(queryKeys.weekendRosterPrefix())
  })

  it('links a filing to a board write-in, then refreshes every surface that shows the link', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })))
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    result.current.mutate({
      kind: 'write_in',
      submissionId: '6600000000000000001',
      unitId: 'u_cedar',
      occupantName: 'Pat Doe',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/jotform/submissions/6600000000000000001/write-in')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(JSON.parse(String(init.body))).toEqual({ unit_id: 'u_cedar', occupant_name: 'Pat Doe' })

    // The board's write-in mark, the push deck and the compare modal all
    // draw the linked filing's request.
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toContainEqual(queryKeys.jotformPrefix())
    expect(keys).toContainEqual(queryKeys.weekendRosterPrefix())
    expect(keys).toContainEqual(queryKeys.pushPreviewPrefix())
    expect(keys).toContainEqual(queryKeys.scenarioComparePrefix())
  })
})
