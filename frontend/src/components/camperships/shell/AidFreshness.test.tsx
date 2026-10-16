import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncStatusResponse } from '../../../hooks/useSyncStatusAPI'
import { AidFreshness } from './AidFreshness'

let granted: string[] = ['financial_aid.view']
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
type StatusOpts = { enabled?: boolean; year?: number | undefined } | undefined
const statusSpy = vi.fn(
  (_opts?: StatusOpts): { data: SyncStatusResponse | null; isPlaceholderData?: boolean } => ({
    data: null,
  })
)
vi.mock('../../../hooks/useSyncStatusAPI', async (importActual) => ({
  ...(await importActual<typeof import('../../../hooks/useSyncStatusAPI')>()),
  useSyncStatusAPI: (opts?: StatusOpts) => statusSpy(opts),
}))
let viewedYear = 2026
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => viewedYear }))

/** The unscoped payload (each job's latest run of any season) and one per synced season (`?year=`). */
function statuses(any: object, bySeason: Record<number, object> = {}) {
  statusSpy.mockImplementation((opts) => {
    const year = opts?.year
    const payload = year === undefined ? any : bySeason[year]
    return { data: (payload ?? null) as SyncStatusResponse | null }
  })
}

function renderFreshness() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AidFreshness />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  granted = ['financial_aid.view']
  viewedYear = 2026
  statusSpy.mockReset()
  statusSpy.mockReturnValue({ data: null })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidFreshness (D5, D69: the two freshness chips)', () => {
  it('reads each line from the job that writes its noun', () => {
    const faApps = { status: 'success', end_time: '2026-10-01T16:00:00Z' }
    statuses(
      {
        _configured_year: 2026,
        financial_aid_applications: faApps,
        aid_postings: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      },
      { 2026: { financial_aid_applications: faApps } }
    )
    renderFreshness()
    expect(screen.getByText(/^Aid apps synced 2h ago$/)).toBeInTheDocument()
    expect(screen.getByText(/^Ledger synced 6h ago$/)).toBeInTheDocument()
  })

  // A dry run stays in the slot (Manage > Sync shows it) but wrote nothing: the line dates the
  // ledger by the last REAL run the backend attaches as last_real_run.
  it('dates a line by the last real run, never a dry run', () => {
    statuses({
      _configured_year: 2026,
      aid_postings: {
        status: 'success',
        end_time: '2026-10-01T17:59:00Z',
        dry_run: true,
        last_real_run: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      },
    })
    renderFreshness()
    expect(screen.getByText(/^Ledger synced 6h ago$/)).toBeInTheDocument()
  })

  it('leaves out a line whose only run is a dry run', () => {
    statuses({
      _configured_year: 2026,
      aid_postings: { status: 'success', end_time: '2026-10-01T17:59:00Z', dry_run: true },
    })
    renderFreshness()
    expect(screen.queryByText(/Ledger/)).toBeNull()
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

  it("dates Aid apps from the season on screen, not whichever season's run finished last", () => {
    // After Oct 15 the sync runs FA applications for 2027 and then 2026. The unscoped payload holds
    // 2026's 1h-old run, but staff on 2027 must see 2027's own (5h ago).
    viewedYear = 2027
    statuses(
      {
        _configured_year: 2027,
        _synced_years: [2027, 2026],
        financial_aid_applications: { status: 'success', end_time: '2026-10-01T17:00:00Z' },
        aid_postings: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      },
      {
        2027: {
          financial_aid_applications: { status: 'success', end_time: '2026-10-01T13:00:00Z' },
        },
        2026: {
          financial_aid_applications: { status: 'success', end_time: '2026-10-01T17:00:00Z' },
        },
      }
    )
    renderFreshness()
    expect(screen.getByText(/^Aid apps synced 5h ago$/)).toBeInTheDocument()
    expect(statusSpy).toHaveBeenCalledWith({ enabled: true, year: 2027 })
  })

  it('keeps the Ledger on its one run: the ledger sync covers every live season at once', () => {
    viewedYear = 2026
    statuses(
      {
        _configured_year: 2027,
        _synced_years: [2027, 2026],
        aid_postings: { status: 'success', end_time: '2026-10-01T12:00:00Z' },
      },
      {
        2026: {
          financial_aid_applications: { status: 'success', end_time: '2026-10-01T16:00:00Z' },
        },
      }
    )
    renderFreshness()
    expect(screen.getByText(/^Aid apps synced 2h ago$/)).toBeInTheDocument()
    expect(screen.getByText(/^Ledger synced 6h ago$/)).toBeInTheDocument()
  })

  it("shows no Aid apps line for a season the sync no longer covers, rather than another season's time", () => {
    viewedYear = 2025
    statuses({
      _configured_year: 2027,
      _synced_years: [2027, 2026],
      financial_aid_applications: { status: 'success', end_time: '2026-10-01T16:00:00Z' },
    })
    renderFreshness()
    expect(screen.queryByText(/Aid apps/)).toBeNull()
    expect(statusSpy).not.toHaveBeenCalledWith(expect.objectContaining({ year: 2025 }))
  })

  it("never shows the season staff just switched away from while the new season's status loads", () => {
    // useSyncStatusAPI keeps the previous key's payload as placeholder data across a season switch.
    viewedYear = 2026
    statusSpy.mockImplementation((opts) =>
      opts?.year === undefined
        ? {
            data: {
              _configured_year: 2027,
              _synced_years: [2027, 2026],
            } as unknown as SyncStatusResponse,
          }
        : {
            data: {
              financial_aid_applications: { status: 'success', end_time: '2026-10-01T13:00:00Z' },
            } as unknown as SyncStatusResponse,
            isPlaceholderData: true,
          }
    )
    renderFreshness()
    expect(screen.queryByText(/Aid apps/)).toBeNull()
  })

  it('reads the status for anyone who can open Camperships, development included', () => {
    granted = ['financial_aid.summary']
    renderFreshness()
    expect(statusSpy).toHaveBeenCalledWith({ enabled: true })
  })
})
