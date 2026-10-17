import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { useSyncFinishInvalidation } from './useSyncFinishInvalidation'
import type { SyncStatusResponse } from './useSyncStatusAPI'

const job = (end: string) => ({ status: 'success', end_time: end })
const status = (end: string) => ({ attendees: job(end) }) as unknown as SyncStatusResponse

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { spy, wrapper }
}

describe('useSyncFinishInvalidation', () => {
  it('does not refetch when the scope changes: the new scope only sets its baseline', () => {
    const { spy, wrapper } = setup()
    const { rerender } = renderHook(
      ({ s, scope }: { s: SyncStatusResponse | null; scope: number }) =>
        useSyncFinishInvalidation(s, ['attendees'], ['metrics'], scope),
      {
        wrapper,
        initialProps: {
          s: status('2026-10-01T00:00:00Z') as SyncStatusResponse | null,
          scope: 2027,
        },
      }
    )
    rerender({ s: null, scope: 2026 })
    rerender({ s: status('2026-09-01T00:00:00Z'), scope: 2026 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('still refetches when a job finishes again within the same scope', () => {
    const { spy, wrapper } = setup()
    const { rerender } = renderHook(
      ({ s }: { s: SyncStatusResponse | null }) =>
        useSyncFinishInvalidation(s, ['attendees'], ['metrics'], 2027),
      { wrapper, initialProps: { s: status('2026-10-01T00:00:00Z') as SyncStatusResponse | null } }
    )
    rerender({ s: status('2026-10-01T01:00:00Z') })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
