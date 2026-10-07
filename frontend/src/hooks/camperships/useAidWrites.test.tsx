/** Camperships writes: through fetchWithAuth, and every read they can move refreshed on settle. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import {
  useAidCancellation,
  useAidCorrection,
  useAidCostOverride,
  useAidDuplicate,
  useAidHeadcount,
  useAidHoldRelease,
  useAidHouseholdShare,
  useAidKeyAsk,
  useAidManualHold,
  useAidRound3Amount,
  useAidRound3Decision,
  useAidSessionResolve,
  useAidTickAccepted,
  useAidTickPosted,
  useAidUndoPosted,
  useAidUseForm,
} from './useAidWrites'

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

describe('the household writes (§6.3)', () => {
  const lastCall = () => {
    const [url, options] = fetchSpy.mock.calls.at(-1) as [string, RequestInit]
    return {
      url,
      method: options.method,
      body: JSON.parse(options.body as string) as unknown,
      auth: new Headers(options.headers).get('Authorization'),
    }
  }

  it('undoes a Posted tick with its reason', async () => {
    const { result } = renderHook(() => useAidUndoPosted(), { wrapper })
    const body = {
      request_id: 'reqsamuel000005',
      round: 1 as const,
      reason: 'Ticked the wrong family',
    }
    await act(() => result.current.mutateAsync({ year: 2027, body }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/decisions/2027/unposted',
      method: 'POST',
      body,
      auth: 'Bearer test-jwt',
    })
  })

  it('keys a Round 3 amount, and finance decides it', async () => {
    const amount = renderHook(() => useAidRound3Amount(), { wrapper }).result
    await act(() =>
      amount.current.mutateAsync({ requestId: 'reqolivia000003', body: { amount: 450, note: '' } })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqolivia000003/round3-amount',
      method: 'POST',
      body: { amount: 450, note: '' },
      auth: 'Bearer test-jwt',
    })
    const decide = renderHook(() => useAidRound3Decision(), { wrapper }).result
    await act(() =>
      decide.current.mutateAsync({
        requestId: 'reqolivia000003',
        body: { approve: true, note: 'Within the reserve' },
      })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqolivia000003/round3-approval',
      method: 'POST',
      body: { approve: true, note: 'Within the reserve' },
      auth: 'Bearer test-jwt',
    })
  })

  it('releases a hold, places a manual one, and cancels with a reason', async () => {
    const release = renderHook(() => useAidHoldRelease(), { wrapper }).result
    await act(() =>
      release.current.mutateAsync({
        requestId: 'reqliam00000002',
        body: { code: 'py_confirm_tier_change', released: true, note: 'Checked with the family' },
      })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqliam00000002/hold-release',
      method: 'POST',
      body: { code: 'py_confirm_tier_change', released: true, note: 'Checked with the family' },
      auth: 'Bearer test-jwt',
    })
    const manual = renderHook(() => useAidManualHold(), { wrapper }).result
    await act(() =>
      manual.current.mutateAsync({
        requestId: 'reqliam00000002',
        body: { held: true, note: 'Waiting on a call' },
      })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqliam00000002/manual-hold',
      method: 'POST',
      body: { held: true, note: 'Waiting on a call' },
      auth: 'Bearer test-jwt',
    })
    const cancel = renderHook(() => useAidCancellation(), { wrapper }).result
    await act(() =>
      cancel.current.mutateAsync({
        requestId: 'reqriley0000004',
        body: { cancelled: true, reason: 'medical', note: '' },
      })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqriley0000004/cancellation',
      method: 'POST',
      body: { cancelled: true, reason: 'medical', note: '' },
      auth: 'Bearer test-jwt',
    })
  })
})

describe('the casework forms’ writes (§6.3)', () => {
  const lastCall = () => {
    const [url, options] = fetchSpy.mock.calls.at(-1) as [string, RequestInit]
    return {
      url,
      method: options.method,
      body: JSON.parse(options.body as string) as unknown,
      auth: new Headers(options.headers).get('Authorization'),
    }
  }

  it('sets a cost override', async () => {
    const { result } = renderHook(() => useAidCostOverride(), { wrapper })
    const body = { amount: 1275, reason_code: 'typed_household_total', note: 'From the form' }
    await act(() => result.current.mutateAsync({ requestId: 'reqemma00000001', body }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqemma00000001/cost-override',
      method: 'POST',
      body,
      auth: 'Bearer test-jwt',
    })
  })

  it('clears a cost override with a null amount', async () => {
    const { result } = renderHook(() => useAidCostOverride(), { wrapper })
    const body = { amount: null, note: 'Entered on the wrong card' }
    await act(() => result.current.mutateAsync({ requestId: 'reqemma00000001', body }))
    expect(lastCall()).toMatchObject({ method: 'POST', body })
  })

  it('corrects an answer on the application', async () => {
    const { result } = renderHook(() => useAidCorrection(), { wrapper })
    const body = { field: 'num_children', new_value: '4', reason: 'Confirmed by phone' }
    await act(() => result.current.mutateAsync({ year: 2027, householdCmId: 1000001, body }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/applications/2027/1000001/corrections',
      method: 'POST',
      body,
      auth: 'Bearer test-jwt',
    })
  })

  it('sends null (not an empty string) to put an answer back to the form’s figure', async () => {
    const { result } = renderHook(() => useAidCorrection(), { wrapper })
    const body = { field: 'num_children', new_value: null, reason: 'The family was right' }
    await act(() => result.current.mutateAsync({ year: 2027, householdCmId: 1000001, body }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/applications/2027/1000001/corrections',
      method: 'POST',
      body: { field: 'num_children', new_value: null, reason: 'The family was right' },
      auth: 'Bearer test-jwt',
    })
  })

  it("uses one camper's form for every disagreeing answer, and refreshes what it moved", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidUseForm(), { wrapper })
    const body = { person_cm_id: 1000002, reason: '' }
    await act(() => result.current.mutateAsync({ year: 2027, householdCmId: 1000001, body }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/applications/2027/1000001/use-form',
      method: 'POST',
      body: { person_cm_id: 1000002, reason: '' },
      auth: 'Bearer test-jwt',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'household-page'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'grid'] })
  })

  it("throws the server's refusal word for word (a 422 is safe to show)", async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: 'nothing on this application disagrees' }), {
          status: 422,
        })
      )
    )
    const { result } = renderHook(() => useAidUseForm(), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          year: 2027,
          householdCmId: 1000001,
          body: { person_cm_id: 1000002, reason: '' },
        })
      ).rejects.toThrow(/^nothing on this application disagrees$/)
    })
  })

  it("sets one household's payer share, and refreshes the jump index too", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidHouseholdShare(), { wrapper })
    const body = { share_pct: '40', reason: 'Parents agreed 60/40' }
    await act(() =>
      result.current.mutateAsync({ requestId: 'reqemma00000001', householdCmId: 1000003, body })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqemma00000001/payer-shares/1000003',
      method: 'PUT',
      body,
      auth: 'Bearer test-jwt',
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'jump-index'] })
  })

  it('settles a session, marks a duplicate and sets a headcount', async () => {
    const session = renderHook(() => useAidSessionResolve(), { wrapper }).result
    const sessionBody = { session_cm_id: 1000101, reason: 'Registered for Session 2' }
    await act(() =>
      session.current.mutateAsync({ requestId: 'reqemma00000001', body: sessionBody })
    )
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqemma00000001/session',
      method: 'POST',
      body: sessionBody,
      auth: 'Bearer test-jwt',
    })
    const duplicate = renderHook(() => useAidDuplicate(), { wrapper }).result
    const dupBody = { duplicate_of: 'reqemma00000001', reason: 'Sent twice' }
    await act(() => duplicate.current.mutateAsync({ requestId: 'reqemmadup00009', body: dupBody }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqemmadup00009/duplicate',
      method: 'POST',
      body: dupBody,
      auth: 'Bearer test-jwt',
    })
    const headcount = renderHook(() => useAidHeadcount(), { wrapper }).result
    const headBody = {
      non_infant: 2,
      infant: 1,
      source: 'override' as const,
      reason: 'Billing shows two adults',
    }
    await act(() => headcount.current.mutateAsync({ requestId: 'reqfamily000010', body: headBody }))
    expect(lastCall()).toEqual({
      url: '/api/financial-aid/requests/reqfamily000010/headcount',
      method: 'PUT',
      body: headBody,
      auth: 'Bearer test-jwt',
    })
  })
})

describe('every money write refreshes Rounds & budget too (slice 2; spec §10)', () => {
  it("invalidates the budget's prefix on settle, through invalidateAidMoneyQueries", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useAidKeyAsk(), { wrapper })
    await act(() => result.current.mutateAsync(ASK))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid', 'budget'] })
  })
})
