/** Money › Sources' writes: the wire, and what each refreshes (the registry and every money read). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { REG_GRANTOR_A_GRANT } from '../../components/camperships/money/registryFixtures'
import {
  useAidClassifySource,
  useAidMapSourceGrantor,
  useAidSetSourceGroup,
} from './useAidSourceWrites'

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
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(REG_GRANTOR_A_GRANT), { status: 200 }))
    )
})
afterEach(() => fetchSpy.mockRestore())

const call = (n: number) => {
  const [url, options] = fetchSpy.mock.calls[n] as [string, RequestInit]
  return {
    url,
    method: options.method,
    body: JSON.parse(options.body as string) as unknown,
    auth: new Headers(options.headers).get('Authorization'),
  }
}

/** Every money read, plus the registry (sources prefix: the registry and Funding sources) and grantors. */
const REFRESHED = ['sources', 'grantors', 'ledger', 'to-place', 'grants', 'budget', 'grid']

describe("Money › Sources' writes", () => {
  it('a classification PATCHes the whole record and refreshes the registry and every money read', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidClassifySource(), { wrapper })
    const body = {
      source_name: 'Grantor A',
      source_family: 'other_outside' as const,
      funder_type: 'outside' as const,
      counts_as_aid: true,
      counts_toward_budget: false,
      implied_program_families: ['summer' as const],
      note: 'Funds summer families',
    }
    await act(() => result.current.mutateAsync({ sourceId: 'srcgrantora0003', body }))
    expect(call(0)).toEqual({
      url: '/api/financial-aid/sources/srcgrantora0003',
      method: 'PATCH',
      body,
      auth: 'Bearer test-jwt',
    })
    for (const key of REFRESHED) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', key] })
    }
  })

  it('a grantor mapping PUTs the key (null unmaps) and the note, and refreshes the registry', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidMapSourceGrantor(), { wrapper })
    const body = { grantor_key: null, note: 'Mapped by mistake' }
    await act(() => result.current.mutateAsync({ sourceId: 'srcgrantora0003', body }))
    expect(call(0)).toEqual({
      url: '/api/financial-aid/sources/srcgrantora0003/grantor',
      method: 'PUT',
      body,
      auth: 'Bearer test-jwt',
    })
    for (const key of REFRESHED) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', key] })
    }
  })

  it("Set a Group… PUTs development's route for the season, and refreshes the registry", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSetSourceGroup(), { wrapper })
    const body = { group: 'pool_a', incentive: false, note: 'Funds summer families' }
    await act(() => result.current.mutateAsync({ year: 2027, sourceId: 'srcgrantore0005', body }))
    expect(call(0)).toEqual({
      url: '/api/financial-aid/reports/2027/funding-sources/srcgrantore0005',
      method: 'PUT',
      body,
      auth: 'Bearer test-jwt',
    })
    for (const key of REFRESHED) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', key] })
    }
  })
})
