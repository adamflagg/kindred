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
})
