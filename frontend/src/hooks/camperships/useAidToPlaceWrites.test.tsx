/** To place's writes: the wire each sends, and what each refreshes on settle (the invalidation map). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  useAidLeaveLine,
  useAidPlaceLine,
  useAidPlaceLines,
  useAidReclassifyLine,
  useAidReopenLine,
} from './useAidToPlaceWrites'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

const PLACED = {
  year: 2027,
  operation_id: 'op0000000000001',
  placed: [3000001],
  ticked: [],
  left_to_tick: [],
}
const WROTE = {
  year: 2027,
  transaction_cm_id: 3000001,
  written: 1,
  operation_id: 'op0000000000002',
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
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PLACED), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const sent = (n = 0) => {
  const [url, options] = fetchSpy.mock.calls[n] as [string, RequestInit]
  return { url, options }
}

describe("To place's writes", () => {
  it('Confirm posts the parts and what it showed it would lock, and refreshes To place and the Ledger', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidPlaceLine(), { wrapper })
    const body = {
      parts: [{ request_id: 'reqemma00000001', amount: '2200.00' }],
      note: '',
      expected_locked: '780.00',
    }
    await act(() => result.current.mutateAsync({ year: 2027, transactionCmId: 3000001, body }))
    const { url, options } = sent()
    expect(url).toBe('/api/financial-aid/money/2027/to-place/3000001/place')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual(body)
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'to-place'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'remaining'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'ledger'] })
  })

  it('a bulk confirm posts every line in one body', async () => {
    const { result } = renderHook(() => useAidPlaceLines(), { wrapper })
    const body = {
      lines: [
        {
          transaction_cm_id: 3000003,
          parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }],
        },
      ],
      note: '',
    }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    expect(sent().url).toBe('/api/financial-aid/money/2027/to-place/place')
    expect(JSON.parse(sent().options.body as string)).toEqual(body)
  })

  it('Leave posts the note', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(WROTE), { status: 200 }))
    )
    const { result } = renderHook(() => useAidLeaveLine(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ year: 2027, transactionCmId: 3000001, note: 'A deposit credit' })
    )
    expect(sent().url).toBe('/api/financial-aid/money/2027/to-place/3000001/leave')
    expect(sent().options.method).toBe('POST')
    expect(JSON.parse(sent().options.body as string)).toEqual({ note: 'A deposit credit' })
  })

  it('Reopen sends a DELETE with its reason in the query, and no body', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(WROTE), { status: 200 }))
    )
    const { result } = renderHook(() => useAidReopenLine(), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        year: 2027,
        transactionCmId: 3000001,
        reason: 'Fixed in CampMinder',
      })
    )
    const { url, options } = sent()
    expect(url).toBe(
      '/api/financial-aid/money/2027/to-place/3000001/leave?reason=Fixed+in+CampMinder'
    )
    expect(options.method).toBe('DELETE')
    expect(options.body).toBeUndefined()
    expect(new Headers(options.headers).get('Content-Type')).toBeNull()
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('Reclassify posts the target and the reason', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(WROTE), { status: 200 }))
    )
    const { result } = renderHook(() => useAidReclassifyLine(), { wrapper })
    const body = { source_key: 'grantor_c_full_ride', reason: 'An outside full-ride line' }
    await act(() => result.current.mutateAsync({ year: 2027, transactionCmId: 3000004, body }))
    expect(sent().url).toBe('/api/financial-aid/money/2027/to-place/3000004/reclassify')
    expect(JSON.parse(sent().options.body as string)).toEqual(body)
  })
})
