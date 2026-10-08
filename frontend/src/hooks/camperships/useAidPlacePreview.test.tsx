/**
 * useAidPlacePreview: what placing parts on a To place line would do right now (#2975; P-4).
 * `useApiWithAuth` is NOT mocked: the header assertion reads what reaches the network.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { queryKeys } from '../../utils/queryKeys'
import { partsKey, useAidPlacePreview } from './useAidPlacePreview'

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

const PREVIEW = {
  year: 2027,
  transaction_cm_id: 3000003,
  parts: [{ request_id: 'reqolivia000003', amount: 1500 }],
  would_tick: [{ request_id: 'reqolivia000003', round: 2, amount: 1500 }],
  would_lock: 1500,
  would_leave: [],
  would_not_tick: [],
}
const BODY = { parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }], note: '' }

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  granted = ['financial_aid.view', 'financial_aid.casework']
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PREVIEW), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useAidPlacePreview', () => {
  it('POSTs the parts through fetchWithAuth, carrying the PocketBase JWT', async () => {
    const { result } = renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(PREVIEW))
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/money/2027/to-place/3000003/preview')
    expect(options.method).toBe('POST')
    expect(options.body).toBe(JSON.stringify(BODY))
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('asks nothing without casework, with no parts, or with nothing to ask', async () => {
    granted = ['financial_aid.view']
    renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderHook(() => useAidPlacePreview(2027, 3000003, null), { wrapper })
    renderHook(() => useAidPlacePreview(2027, 3000003, { parts: [] }), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps no answer once nothing reads it (gcTime 0: the next open asks again)', async () => {
    const key = queryKeys.aidPlacePreview(2027, 3000003, partsKey(BODY))
    const first = renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    await waitFor(() => expect(first.result.current.data).toEqual(PREVIEW))
    // R1-1: `QueryCache.find` matches exactly by default (TanStack v5), so a partial key there
    // finds nothing whether or not the answer was kept. Find the query by its own key first...
    expect(client.getQueryCache().find({ queryKey: key, exact: true })).toBeDefined()
    first.unmount()
    // ...then every preview under the prefix (`findAll` matches a partial key).
    await waitFor(() =>
      expect(
        client.getQueryCache().findAll({ queryKey: ['financial-aid', 'to-place', 2027, 'preview'] })
      ).toHaveLength(0)
    )
    // Opening the line again asks the server again.
    const second = renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    await waitFor(() => expect(second.result.current.data).toEqual(PREVIEW))
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(partsKey(BODY)).toBe('reqolivia000003:1500.00')
  })

  it('shares one answer between everything reading the same parts while the line is open (R1-2)', async () => {
    const opened = renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    await waitFor(() => expect(opened.result.current.data).toEqual(PREVIEW))
    // "Edit the Split…" opening on the suggestion's parts reads the same key: no second POST.
    const editor = renderHook(() => useAidPlacePreview(2027, 3000003, BODY), { wrapper })
    expect(editor.result.current.data).toEqual(PREVIEW)
    await settle()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // The same parts in another order are the same question.
    const a = { request_id: 'reqemma00000001', amount: '2200.00' }
    const b = { request_id: 'reqsamuel000002', amount: '1420.00' }
    expect(partsKey({ parts: [b, a] })).toBe(partsKey({ parts: [a, b] }))
  })
})
