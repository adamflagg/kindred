/**
 * Requests › Form intake's reads and writes (PR 3): through fetchWithAuth, view-gated, and every write refreshes
 * Form intake, its summary, Season's line, Requests, the household page and Today. `useApiWithAuth` is NOT mocked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { invalidateAidMoneyQueries, queryKeys } from '../../utils/queryKeys'
import {
  useAidAidOnNoRequest,
  useAidIntakeForms,
  useAidIntakeSummary,
  useAidIntakeUnlisted,
} from './useAidIntake'
import { useAidAddRequest, useAidRetireAddition, useAidReviewAddition } from './useAidIntakeWrites'

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
const BODY = { year: 2027, rows: [] }

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
afterEach(() => fetchSpy.mockRestore())

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const lastCall = () => fetchSpy.mock.calls.at(-1) as [string, RequestInit]

describe('the reads', () => {
  it.each<[string, () => { data: unknown }, string]>([
    ['forms', () => useAidIntakeForms(), '/api/financial-aid/intake/2027/forms'],
    ['summary', () => useAidIntakeSummary(), '/api/financial-aid/intake/2027/summary'],
    [
      'aid on no request',
      () => useAidAidOnNoRequest(true),
      '/api/financial-aid/intake/2027/aid-on-no-request',
    ],
  ])('reads %s through fetchWithAuth', async (_, hook, url) => {
    const { result } = renderHook(hook, { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BODY))
    expect(lastCall()[0]).toBe(url)
    expect(new Headers(lastCall()[1].headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('searches the unlisted campers by the typed words, and not under two characters', async () => {
    const short = renderHook(() => useAidIntakeUnlisted('S'), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
    short.unmount()
    const { result } = renderHook(() => useAidIntakeUnlisted('Sofia Chen'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(BODY))
    expect(lastCall()[0]).toBe('/api/financial-aid/intake/2027/unlisted?q=Sofia+Chen')
  })

  it("reads Season's line only while it is open", async () => {
    renderHook(() => useAidAidOnNoRequest(false), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads nothing without view', async () => {
    granted = ['financial_aid.summary']
    renderHook(() => useAidIntakeSummary(), { wrapper })
    renderHook(() => useAidIntakeForms(), { wrapper })
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the writes refresh every read they move', () => {
  const MOVED = [
    ['financial-aid', 'intake'],
    ['financial-aid', 'grid'],
    ['financial-aid', 'household-page'],
    ['financial-aid', 'today'],
    ['financial-aid', 'budget'],
  ]

  it('Add a Request… posts the addition with its Round 1', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidAddRequest(), { wrapper })
    const body = {
      household_cm_id: 1000004,
      person_cm_id: 1000041,
      session_cm_id: 1000103,
      ask: 2500,
      reason: 'Assessed by phone',
      round1_campminder: 2258,
    }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    expect(lastCall()[0]).toBe('/api/financial-aid/requests/2027/additions')
    expect(lastCall()[1].method).toBe('POST')
    expect(JSON.parse(lastCall()[1].body as string)).toEqual(body)
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
    // A household with no aid activity gains some: the jump box's index too.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'jump-index'] })
  })

  it('Mark Reviewed posts the review', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidReviewAddition(), { wrapper })
    await act(() => result.current.mutateAsync({ year: 2027, additionId: 'addava00000001' }))
    expect(lastCall()[0]).toBe('/api/financial-aid/requests/2027/additions/addava00000001/review')
    expect(lastCall()[1].method).toBe('POST')
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })

  it("Remove… posts the retire with its reason, and a refusal keeps the server's words", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidRetireAddition(), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        year: 2027,
        additionId: 'addchenhh00001',
        reason: 'Family is not attending',
      })
    )
    expect(lastCall()[0]).toBe('/api/financial-aid/requests/2027/additions/addchenhh00001/retire')
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ reason: 'Family is not attending' })
    for (const queryKey of MOVED) expect(invalidate).toHaveBeenCalledWith({ queryKey })
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'Round 1 is posted: undo Posted first' }), {
          status: 422,
        })
      )
    )
    await act(async () => {
      await expect(
        result.current.mutateAsync({ year: 2027, additionId: 'addchenhh00001', reason: 'x' })
      ).rejects.toThrow('Round 1 is posted: undo Posted first')
    })
  })
})

describe('every Camperships write refreshes Form intake (a cancel or a settled session moves Became)', () => {
  it('invalidateAidMoneyQueries clears the intake prefix', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await invalidateAidMoneyQueries(client)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.aidIntakePrefix() })
  })
})
