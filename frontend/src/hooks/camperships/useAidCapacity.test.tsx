/** Session capacity: through fetchWithAuth, view-level read, rules-level write, and what a save refreshes. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { queryKeys } from '../../utils/queryKeys'
import { useAidSessionCapacities, useAidSetCapacity } from './useAidCapacity'

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

const LIST = {
  year: 2027,
  sessions: [{ year: 2027, session_cm_id: 1000101, capacity: 90, note: '', actor: 'A' }],
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  granted = ['financial_aid.view']
  authLoading = false
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(LIST), { status: 200 })))
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

describe('useAidSessionCapacities (view-level read)', () => {
  it('reads the stored capacities with the signed-in header, for view alone', async () => {
    const { result } = renderHook(() => useAidSessionCapacities(2027), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(LIST))
    expect(sent()).toEqual({
      url: '/api/financial-aid/capacity/2027',
      method: 'GET',
      body: null,
      auth: 'Bearer test-jwt',
    })
    expect(client.getQueryState(queryKeys.aidCapacity(2027))?.status).toBe('success')
  })

  it('waits for the session and for the view permission', () => {
    granted = []
    renderHook(() => useAidSessionCapacities(2027), { wrapper })
    authLoading = true
    granted = ['financial_aid.view']
    renderHook(() => useAidSessionCapacities(2027), { wrapper })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('useAidSetCapacity (rules-level write)', () => {
  it('PUTs the figure and note, and refreshes its own read, History and the household page', async () => {
    granted = ['financial_aid.view', 'financial_aid.rules']
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSetCapacity(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ sessionCmId: 1000102, body: { capacity: 120, note: 'n' } })
    )
    expect(sent()).toEqual({
      url: '/api/financial-aid/capacity/2027/1000102',
      method: 'PUT',
      body: { capacity: 120, note: 'n' },
      auth: 'Bearer test-jwt',
    })
    const keys = invalidate.mock.calls.map(
      ([args]) => (args as { queryKey: readonly unknown[] }).queryKey
    )
    expect(keys).toContainEqual(queryKeys.aidCapacity(2027))
    expect(keys).toContainEqual(queryKeys.aidHistoryPrefix())
    expect(keys).toContainEqual(queryKeys.aidHouseholdPagePrefix())
    // It moves no money figure.
    expect(keys).not.toContainEqual(queryKeys.aidBudgetPrefix())
    expect(keys).not.toContainEqual(queryKeys.aidRemainingPrefix())
    expect(keys).not.toContainEqual(queryKeys.aidRulesPrefix())
  })

  it('settles only once the refreshes have, so a reopened form starts from the saved figure', async () => {
    const finishers: Array<() => void> = []
    vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () => new Promise<void>((resolve) => finishers.push(resolve))
    )
    const { result } = renderHook(() => useAidSetCapacity(), { wrapper })
    let settled = false
    const done = result.current
      .mutateAsync({ sessionCmId: 1000102, body: { capacity: 1, note: '' } })
      .then(() => {
        settled = true
      })
    await waitFor(() => expect(finishers).toHaveLength(3))
    expect(settled).toBe(false)
    finishers.forEach((finish) => finish())
    await done
    expect(settled).toBe(true)
  })

  it('refreshes on a refusal too: the data may have moved', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ detail: 'no' }), { status: 403 }))
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSetCapacity(), { wrapper })
    await act(() =>
      result.current
        .mutateAsync({ sessionCmId: 1000102, body: { capacity: 1, note: '' } })
        .catch(() => undefined)
    )
    expect(invalidate).toHaveBeenCalled()
  })
})
