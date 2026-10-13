import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { SyncStatusResponse } from '../useSyncStatusAPI'
import { useAidSyncInvalidation } from './useAidSyncInvalidation'

function status(ledgerEnd: string, applicationsEnd: string): SyncStatusResponse {
  return {
    aid_postings: { status: 'success', end_time: ledgerEnd },
    financial_aid_applications: { status: 'success', end_time: applicationsEnd },
  } as unknown as SyncStatusResponse
}

function setup() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { invalidate, wrapper }
}

describe('useAidSyncInvalidation (spec §10: ledger-sync completion refreshes every aid read)', () => {
  it('does nothing on the first status it sees', () => {
    const { invalidate, wrapper } = setup()
    renderHook(({ s }) => useAidSyncInvalidation(s), {
      wrapper,
      initialProps: { s: status('a', 'b') },
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("invalidates every 'financial-aid' read when the ledger sync finishes again", () => {
    const { invalidate, wrapper } = setup()
    const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
      wrapper,
      initialProps: { s: status('2026-10-01T07:00:00Z', 'x') },
    })
    rerender({ s: status('2026-10-01T07:00:00Z', 'x') })
    expect(invalidate).not.toHaveBeenCalled()

    rerender({ s: status('2026-10-02T07:00:00Z', 'x') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-aid'] })
  })

  it('invalidates when the FA-applications sync finishes again (new families)', () => {
    const { invalidate, wrapper } = setup()
    const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
      wrapper,
      initialProps: { s: status('a', '2026-10-01T06:00:00Z') },
    })
    rerender({ s: status('a', '2026-10-02T06:00:00Z') })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('ignores a missing status (a 401 answers null)', () => {
    const { invalidate, wrapper } = setup()
    const { rerender } = renderHook<unknown, { s: SyncStatusResponse | null }>(
      ({ s }) => useAidSyncInvalidation(s),
      {
        wrapper,
        initialProps: { s: status('a', 'b') },
      }
    )
    rerender({ s: null })
    rerender({ s: status('a', 'b') })
    expect(invalidate).not.toHaveBeenCalled()
  })

  describe('only a finished job moves it (a pending or running job has no end_time)', () => {
    type Job = { status: string; end_time?: string; start_time?: string }
    const done = (end: string): Job => ({ status: 'success', end_time: end })
    const pending: Job = { status: 'pending' }
    const running: Job = { status: 'running', start_time: '2026-10-13T03:00:00Z' }
    const jobs = (ledger: Job, applications: Job) =>
      ({
        aid_postings: ledger,
        financial_aid_applications: applications,
      }) as unknown as SyncStatusResponse

    it('refreshes once per completed aid job across a whole daily run, never on pending or running', () => {
      const { invalidate, wrapper } = setup()
      const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
        wrapper,
        initialProps: { s: jobs(done('2026-10-12T03:05:00Z'), done('2026-10-12T03:04:00Z')) },
      })
      // The sequence a daily run publishes, poll by poll (2026-10-12 synthetic repro): both
      // queued, then FA applications runs and finishes, then the ledger runs and finishes.
      rerender({ s: jobs(pending, pending) })
      rerender({ s: jobs(pending, running) })
      expect(invalidate).not.toHaveBeenCalled()

      rerender({ s: jobs(pending, done('2026-10-13T03:04:00Z')) })
      expect(invalidate).toHaveBeenCalledTimes(1)

      rerender({ s: jobs(running, done('2026-10-13T03:04:00Z')) })
      expect(invalidate).toHaveBeenCalledTimes(1)

      rerender({ s: jobs(done('2026-10-13T03:05:00Z'), done('2026-10-13T03:04:00Z')) })
      rerender({ s: jobs(done('2026-10-13T03:05:00Z'), done('2026-10-13T03:04:00Z')) })
      expect(invalidate).toHaveBeenCalledTimes(2)
      expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ['financial-aid'] })
    })

    it('counts a failed run as finished: it may have written part of its rows', () => {
      const { invalidate, wrapper } = setup()
      const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
        wrapper,
        initialProps: { s: jobs(done('2026-10-12T03:05:00Z'), done('x')) },
      })
      rerender({ s: jobs(running, done('x')) })
      rerender({ s: jobs({ status: 'failed', end_time: '2026-10-13T03:05:00Z' }, done('x')) })
      expect(invalidate).toHaveBeenCalledTimes(1)
    })

    it("refreshes on a job's first ever completion, but not on the idle answer before it", () => {
      const { invalidate, wrapper } = setup()
      const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
        wrapper,
        initialProps: { s: jobs({ status: 'idle' }, done('x')) },
      })
      rerender({ s: jobs(pending, done('x')) })
      rerender({ s: jobs(running, done('x')) })
      expect(invalidate).not.toHaveBeenCalled()
      rerender({ s: jobs(done('2026-10-13T03:05:00Z'), done('x')) })
      expect(invalidate).toHaveBeenCalledTimes(1)
    })

    it('a page opened mid-run takes the first finish it sees as a completion', () => {
      const { invalidate, wrapper } = setup()
      const { rerender } = renderHook(({ s }) => useAidSyncInvalidation(s), {
        wrapper,
        initialProps: { s: jobs(running, done('x')) },
      })
      rerender({ s: jobs(done('2026-10-13T03:05:00Z'), done('x')) })
      expect(invalidate).toHaveBeenCalledTimes(1)
    })
  })
})
