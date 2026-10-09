import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncStatusResponse } from '../../../hooks/useSyncStatusAPI'
import { AidFreshness } from './AidFreshness'

let granted: string[] = ['financial_aid.view']
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
const statusSpy = vi.fn((_opts?: unknown): { data: SyncStatusResponse | null } => ({ data: null }))
vi.mock('../../../hooks/useSyncStatusAPI', async (importActual) => ({
  ...(await importActual<typeof import('../../../hooks/useSyncStatusAPI')>()),
  useSyncStatusAPI: (opts?: unknown) => statusSpy(opts),
}))

function renderFreshness() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AidFreshness />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidFreshness (D5, D69: the two freshness chips)', () => {
  it('reads each line from the job that writes its noun', () => {
    statusSpy.mockReturnValue({
      data: {
        financial_aid_applications: { status: 'success', end_time: '2026-10-01T16:00:00Z' },
        aid_postings: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      } as unknown as SyncStatusResponse,
    })
    renderFreshness()
    expect(screen.getByText(/^Aid apps synced 2h ago$/)).toBeInTheDocument()
    expect(screen.getByText(/^Ledger synced 6h ago$/)).toBeInTheDocument()
  })

  it("stays grey: a condition, not an alarm (#1706, summer's rule)", () => {
    statusSpy.mockReturnValue({
      data: {
        aid_postings: { status: 'failed', end_time: '2026-09-28T12:00:00Z' },
      } as unknown as SyncStatusResponse,
    })
    renderFreshness()
    expect(screen.getByText(/^Ledger synced/).parentElement).toHaveClass('text-muted-foreground')
  })

  it('leaves out a line no run has written', () => {
    statusSpy.mockReturnValue({
      data: {
        aid_postings: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      } as unknown as SyncStatusResponse,
    })
    renderFreshness()
    expect(screen.queryByText(/Aid apps/)).toBeNull()
  })

  it('reads the status for anyone who can open Camperships, development included', () => {
    granted = ['financial_aid.summary']
    renderFreshness()
    expect(statusSpy).toHaveBeenCalledWith({ enabled: true })
  })
})
