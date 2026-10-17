/**
 * useAnalyticsSyncRefetch — Analytics refetches after a sync (epic #3207 PR 5).
 *
 * Enrollments, people and sessions sync every hour now, and the server clears its metrics cache
 * after each job, but a browser holding Analytics open kept the numbers it fetched until the
 * 30-minute staleTime ran out and something remounted them. This watches the viewed season's
 * own runs of the jobs Analytics reads, on the status the freshness chip already reads, and
 * refetches every 'metrics' query when one of them finishes again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Opts {
  enabled?: boolean
  year?: number
}
let unscoped: unknown
let scoped: Record<number, unknown>

vi.mock('./useSyncStatusAPI', () => ({
  useSyncStatusAPI: (opts: Opts = {}) => {
    if (opts.year === undefined) return { data: unscoped }
    return { data: opts.enabled === false ? undefined : scoped[opts.year] }
  },
}))

import { useAnalyticsSyncRefetch } from './useAnalyticsSyncRefetch'

interface Job {
  status: string
  end_time?: string
}
const done = (end_time: string): Job => ({ status: 'success', end_time })
const running: Job = { status: 'running' }

function season(jobs: Record<string, Job>) {
  return {
    sessions: done('2026-10-27T10:00:00Z'),
    attendees: done('2026-10-27T10:00:05Z'),
    persons: done('2026-10-27T10:00:30Z'),
    enrollment_snapshots: done('2026-10-27T10:20:00Z'),
    bunk_assignments: done('2026-10-27T10:00:40Z'),
    ...jobs,
  }
}

function setup(year = 2027) {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(({ y }) => useAnalyticsSyncRefetch(y), {
    wrapper,
    initialProps: { y: year },
  })
  return { invalidate, rerender: () => hook.rerender({ y: year }) }
}

beforeEach(() => {
  unscoped = { _synced_years: [2027, 2026] }
  scoped = { 2027: season({}), 2026: season({}) }
})

describe('useAnalyticsSyncRefetch', () => {
  it('does nothing on the first status it sees', () => {
    const { invalidate } = setup()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it.each(['sessions', 'attendees', 'persons', 'enrollment_snapshots'])(
    "refetches every 'metrics' query when %s finishes again",
    (job) => {
      const { invalidate, rerender } = setup()
      scoped[2027] = season({ [job]: done('2026-10-27T11:00:30Z') })
      rerender()
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['metrics'] })
    }
  )

  it('leaves Analytics alone when only the bunk assignments run (nothing it reads)', () => {
    const { invalidate, rerender } = setup()
    scoped[2027] = season({ bunk_assignments: done('2026-10-27T11:00:40Z') })
    rerender()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does nothing while the run is going, then refetches when it finishes', () => {
    const { invalidate, rerender } = setup()
    scoped[2027] = season({ attendees: running })
    rerender()
    expect(invalidate).not.toHaveBeenCalled()
    scoped[2027] = season({ attendees: done('2026-10-27T11:00:05Z') })
    rerender()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it("watches the viewed season's runs, not the other season's", () => {
    const { invalidate, rerender } = setup(2027)
    scoped[2026] = season({ attendees: done('2026-10-27T11:01:05Z') })
    rerender()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('reads nothing for a season the scheduled runs do not cover', () => {
    scoped[2019] = season({})
    const { invalidate, rerender } = setup(2019)
    scoped[2019] = season({ attendees: done('2026-10-27T11:00:05Z') })
    rerender()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
