/** Grants' writes: the wire each sends, and what each refreshes on settle (the invalidation map). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  useAidCreateCommitment,
  useAidPlaceGrants,
  useAidSaveCommitment,
  useAidWithdrawCommitment,
} from './useAidGrantWrites'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient()
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))
})
afterEach(() => fetchSpy.mockRestore())

const sent = () => {
  const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
  return {
    url,
    method: options.method,
    auth: new Headers(options.headers).get('Authorization'),
    body: JSON.parse(options.body as string) as unknown,
  }
}
const COMMITMENT = {
  grantor_key: 'grantor_c',
  household_cm_id: 1000004,
  person_cm_id: 2000004,
  session_cm_id: 1000103,
  amount: '6200.00',
  committed_on: '2027-04-02',
  note: 'Letter of Apr 2',
}

describe("Grants' writes", () => {
  it('places campers in one body, and refreshes Grants, the money reads and the Ledger', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidPlaceGrants(), { wrapper })
    const body = {
      placements: [{ transaction_cm_id: 4000002, person_cm_id: 2000002, session_cm_id: 1000102 }],
      note: '',
    }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    expect(sent()).toEqual({
      url: '/api/financial-aid/grants/2027/placements',
      method: 'POST',
      auth: 'Bearer test-jwt',
      body,
    })
    for (const key of ['grants', 'remaining', 'budget', 'grid', 'household-page', 'ledger']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', key] })
    }
    // A placement names no grantor and classifies no source.
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grantors'] })
  })

  it('records a commitment', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidCreateCommitment(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027, body: COMMITMENT }))
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grants/2027/commitments',
      method: 'POST',
      body: COMMITMENT,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grants'] })
  })

  it('saves one whole', async () => {
    const { result } = renderHook(() => useAidSaveCommitment(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ year: 2027, commitmentId: 'cmtriley0000001', body: COMMITMENT })
    )
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grants/2027/commitments/cmtriley0000001',
      method: 'PUT',
      body: COMMITMENT,
    })
  })

  it('withdraws one with a reason', async () => {
    const { result } = renderHook(() => useAidWithdrawCommitment(), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        year: 2027,
        commitmentId: 'cmtriley0000001',
        reason: 'Grantor declined',
      })
    )
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grants/2027/commitments/cmtriley0000001/withdraw',
      method: 'POST',
      body: { reason: 'Grantor declined' },
    })
  })
})
