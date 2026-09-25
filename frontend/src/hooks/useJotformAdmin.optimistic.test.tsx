/**
 * Queue actions move their row at once (kindred#2839 follow-up, owner report
 * 2026-09-25: "unlink feels a little slow"). The row used to wait for the POST
 * and then a full queue refetch; now the cached queue -- every scenario's
 * Requests tab and the year's queue the board's picker reads -- moves it
 * before the POST returns, the filer's other filings the server names follow
 * on its answer, and a refused action puts everything back. The refetch still
 * runs after, and is what the tab settles on. Fictional names only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { JotformQueue, JotformQueueEntry } from '../types/jotform'
import { queryKeys } from '../utils/queryKeys'
import { useJotformSubmissionAction, useJotformWeekendQueue } from './useJotformAdmin'

vi.mock('../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

const WW = 1000002
const WEEKEND_KEY = queryKeys.jotformWeekendQueue(2026, WW, '')
const SCENARIO_KEY = queryKeys.jotformWeekendQueue(2026, WW, 'scn_a')
const YEAR_KEY = queryKeys.jotformQueue(2026)

let client: QueryClient
let fetchSpy: MockInstance<typeof fetch>

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function entry(
  id: string,
  name: string,
  extra: Partial<JotformQueueEntry> = {}
): JotformQueueEntry {
  return {
    submission_id: id,
    session_cm_id: WW,
    submitted_name: name,
    submitted_at: '2026-08-31 09:00:00',
    match_status: 'unmatched',
    ...extra,
  }
}

function seed(): JotformQueue {
  return {
    year: 2026,
    session_cm_id: WW,
    scenario: '',
    unmatched: [entry('s1', 'Emma Johnson'), entry('s2', 'Emma Johnson')],
    resolved: [
      entry('s3', 'Olivia Chen', {
        match_status: 'staff',
        person_cm_id: 1000005,
        guest_name: 'Olivia Chen',
      }),
      entry('s4', 'Liam Garcia', { match_status: 'ignored' }),
    ],
    cancelled: [],
    write_ins: [
      entry('s5', 'Riley Sam', {
        match_status: 'write_in',
        write_in_name: 'Riley Sam',
        write_in_unit: 'Cedar 3',
        write_in_placed: true,
      }),
    ],
    write_in_options: [
      {
        option_id: 'u_cedar/Emma J',
        session_cm_id: WW,
        unit_id: 'u_cedar',
        unit_name: 'Cedar 3',
        occupant_name: 'Emma J',
      },
    ],
    guests: [
      {
        person_cm_id: 1000007,
        display_name: 'Emma Johnston',
        session_cm_id: WW,
        has_submission: false,
      },
    ],
  }
}

const ids = (rows: readonly JotformQueueEntry[] | undefined) =>
  (rows ?? []).map((r) => r.submission_id)
const cached = (key: readonly unknown[] = WEEKEND_KEY) => client.getQueryData<JotformQueue>(key)

/** A POST that never answers, so the test sees the queue before the server does. */
function hangingPost() {
  fetchSpy.mockImplementation(() => new Promise<Response>(() => undefined))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(WEEKEND_KEY, seed())
  client.setQueryData(SCENARIO_KEY, { ...seed(), scenario: 'scn_a' })
  client.setQueryData(YEAR_KEY, { ...seed(), session_cm_id: null, scenario: '' })
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('useJotformSubmissionAction moves the row before the server answers', () => {
  it('unlink: a staff link goes back to Needs a guest, in every cached queue', async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'unlink', submissionId: 's3' })
    })
    await waitFor(() => {
      expect(ids(cached()?.resolved)).toEqual(['s4'])
    })
    for (const key of [WEEKEND_KEY, SCENARIO_KEY, YEAR_KEY]) {
      const moved = cached(key)?.unmatched?.find((r) => r.submission_id === 's3')
      expect(moved).toMatchObject({ match_status: 'unmatched', person_cm_id: 0, guest_name: '' })
    }
  })

  it('restore: an ignored filing goes back to Needs a guest', async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'unlink', submissionId: 's4' })
    })
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toContain('s4')
    })
    expect(ids(cached()?.resolved)).toEqual(['s3'])
  })

  it('unlink of a write-in link leaves the Write-ins list', async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'unlink', submissionId: 's5' })
    })
    await waitFor(() => {
      expect(ids(cached()?.write_ins)).toEqual([])
    })
    expect(ids(cached()?.unmatched)).toContain('s5')
  })

  it('ignore: the filing moves to Ignored', async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'ignore', submissionId: 's1' })
    })
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toEqual(['s2'])
    })
    expect(cached()?.resolved?.find((r) => r.submission_id === 's1')).toMatchObject({
      match_status: 'ignored',
    })
  })

  it("link: the filing moves to Staff links under the guest's name", async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'link', submissionId: 's1', personCmId: 1000007 })
    })
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toEqual(['s2'])
    })
    expect(cached()?.resolved?.find((r) => r.submission_id === 's1')).toMatchObject({
      match_status: 'staff',
      person_cm_id: 1000007,
      guest_name: 'Emma Johnston',
    })
  })

  it('write-in link: the filing moves to Write-ins, named for the write-in', async () => {
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({
        kind: 'write_in',
        submissionId: 's1',
        unitId: 'u_cedar',
        occupantName: 'Emma J',
      })
    })
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toEqual(['s2'])
    })
    expect(cached()?.write_ins?.find((r) => r.submission_id === 's1')).toMatchObject({
      match_status: 'write_in',
      write_in_name: 'Emma J',
      write_in_unit: 'Cedar 3',
    })
  })

  it("moves the filer's other filings the server names, once it answers", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          action: 'ignored',
          also: [
            {
              submission_id: 's2',
              submitted_name: 'Emma Johnson',
              submitted_at: '2026-08-31 09:00:00',
            },
          ],
        }),
        { status: 200 }
      )
    )
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'ignore', submissionId: 's1' })
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(ids(cached()?.unmatched)).toEqual([])
    expect(ids(cached()?.resolved)).toEqual(['s3', 's4', 's1', 's2'])
  })

  it('puts every cached queue back when the server refuses', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'That person is not an enrolled guest' }), {
        status: 422,
      })
    )
    const before = [cached(WEEKEND_KEY), cached(SCENARIO_KEY), cached(YEAR_KEY)]
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({ kind: 'link', submissionId: 's1', personCmId: 1000099 })
    })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect([cached(WEEKEND_KEY), cached(SCENARIO_KEY), cached(YEAR_KEY)]).toEqual(before)
  })
})

describe('a write-in link in a scope without that write-in', () => {
  it('reads as not placed there, as the server will say', async () => {
    client.setQueryData(SCENARIO_KEY, { ...seed(), scenario: 'scn_a', write_in_options: [] })
    hangingPost()
    const { result } = renderHook(() => useJotformSubmissionAction(), { wrapper })
    act(() => {
      result.current.mutate({
        kind: 'write_in',
        submissionId: 's1',
        unitId: 'u_cedar',
        occupantName: 'Emma J',
      })
    })
    await waitFor(() => {
      expect(ids(cached(SCENARIO_KEY)?.unmatched)).toEqual(['s2'])
    })
    const here = cached(WEEKEND_KEY)?.write_ins?.find((r) => r.submission_id === 's1')
    const there = cached(SCENARIO_KEY)?.write_ins?.find((r) => r.submission_id === 's1')
    expect(here?.write_in_placed).toBe(true)
    expect(there?.write_in_placed).toBe(false)
  })
})

describe('two actions in flight at once', () => {
  /**
   * Staff act on two rows faster than the server answers. The first answer's
   * refetch must not put the second row back while its own POST is still in
   * flight: the row would reappear with live buttons and could be acted on
   * twice. The refetch waits for the last action to settle.
   */
  it("the first answer's refetch does not bring back a row still being acted on", async () => {
    let answerFirst: (response: Response) => void = () => undefined
    const firstPost = new Promise<Response>((resolve) => {
      answerFirst = resolve
    })
    let answerSecond: (response: Response) => void = () => undefined
    const secondPost = new Promise<Response>((resolve) => {
      answerSecond = resolve
    })
    let posts = 0
    // The server's queue before the second action lands: s2 still waiting.
    const serverQueue = () => ({ ...seed(), unmatched: [entry('s2', 'Emma Johnson')] })
    fetchSpy.mockImplementation((input, init) => {
      if (init?.method === 'POST') {
        posts++
        return posts === 1 ? firstPost : secondPost
      }
      void input
      return Promise.resolve(new Response(JSON.stringify(serverQueue()), { status: 200 }))
    })
    const { result } = renderHook(
      () => ({
        queue: useJotformWeekendQueue(2026, WW, ''),
        first: useJotformSubmissionAction(),
        second: useJotformSubmissionAction(),
      }),
      { wrapper }
    )
    await waitFor(() => {
      expect(result.current.queue.isFetching).toBe(false)
    })
    client.setQueryData(WEEKEND_KEY, seed())

    act(() => {
      result.current.first.mutate({ kind: 'ignore', submissionId: 's1' })
    })
    act(() => {
      result.current.second.mutate({ kind: 'ignore', submissionId: 's2' })
    })
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toEqual([])
    })

    answerFirst(new Response(null, { status: 204 }))
    await waitFor(() => {
      expect(result.current.first.isSuccess).toBe(true)
    })
    await waitFor(() => {
      expect(result.current.queue.isFetching).toBe(false)
    })
    expect(ids(cached()?.unmatched)).toEqual([])

    answerSecond(new Response(null, { status: 204 }))
    await waitFor(() => {
      expect(result.current.second.isSuccess).toBe(true)
    })
    // The last one to settle refetches, and the tab settles on the server.
    await waitFor(() => {
      expect(ids(cached()?.unmatched)).toEqual(['s2'])
    })
  })
})
