/** Grants › Grantors' writes: the wire, and the registry and money reads they refresh (D143, D160). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { GRANTOR_A } from '../../components/camperships/grants/grantorDirectoryFixtures'
import {
  useAidCreateGrantor,
  useAidRetireGrantor,
  useAidSaveGrantor,
  useAidUnretireGrantor,
} from './useAidGrantorWrites'

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
      Promise.resolve(new Response(JSON.stringify(GRANTOR_A), { status: 200 }))
    )
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
const SAVE = { name: 'Grantor A', aliases: [], note: 'Renamed' }

describe('the grantor writes', () => {
  it('creates, and refreshes the directory, the registry, Grants and the money reads', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidCreateGrantor(), { wrapper })
    await act(() => result.current.mutateAsync({ ...SAVE, key: 'grantor_a' }))
    expect(sent()).toEqual({
      url: '/api/financial-aid/grantors',
      method: 'POST',
      auth: 'Bearer test-jwt',
      body: { ...SAVE, key: 'grantor_a' },
    })
    for (const key of ['grantors', 'sources', 'grants', 'remaining', 'ledger']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', key] })
    }
  })

  it('saves whole, and refreshes the registry even when refused', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Someone else changed this' }), { status: 409 })
      )
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidSaveGrantor(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ key: 'grantor_a', body: SAVE })).rejects.toThrow(
        'Someone else changed this'
      )
    })
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grantors/grantor_a',
      method: 'PUT',
      body: SAVE,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grantors'] })
  })

  it('retires and unretires with a reason', async () => {
    const retire = renderHook(() => useAidRetireGrantor(), { wrapper })
    await act(() =>
      retire.result.current.mutateAsync({ key: 'grantor_f', reason: 'Duplicate of Grantor B' })
    )
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grantors/grantor_f/retire',
      method: 'POST',
      body: { reason: 'Duplicate of Grantor B' },
    })
    fetchSpy.mockClear()
    const unretire = renderHook(() => useAidUnretireGrantor(), { wrapper })
    await act(() =>
      unretire.result.current.mutateAsync({ key: 'grantor_f', reason: 'Still funds weekends' })
    )
    expect(sent()).toMatchObject({
      url: '/api/financial-aid/grantors/grantor_f/unretire',
      method: 'POST',
      body: { reason: 'Still funds weekends' },
    })
  })
})
