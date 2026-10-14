import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { SYNC_TYPE_NAMES, useRunIndividualSync } from './useRunIndividualSync'
import { getBackendSyncJobIds, getBackendSyncPostRouteSegments } from '../test/backendSyncJobIds'
import { queryKeys } from '../utils/queryKeys'

const send = vi.fn()
vi.mock('../lib/pocketbase', () => ({
  pb: { send: (...args: unknown[]) => send(...args) as unknown },
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

describe('SYNC_TYPE_NAMES', () => {
  it('includes stranded_assignment_cleanup', () => {
    expect(SYNC_TYPE_NAMES['stranded_assignment_cleanup']).toBeDefined()
    expect(SYNC_TYPE_NAMES['stranded_assignment_cleanup']).toBe('Stranded Assignment Cleanup')
  })

  // kindred#2593: this map is the one whose absence throws at click time --
  // useRunIndividualSync rejects an id that is not a key with `Unknown sync type`, and
  // SyncTab's handleRun falls through to it for any card without its own switch case. It was
  // also the last of the four id-keyed maps with no backend anchor: the coverage guards added
  // for the card list, the toast list and the status interface all skipped it, so the next card
  // added to syncTypes.ts could reproduce exactly the bug this PR fixed with all three of them
  // green.
  //
  // The right anchor is not statusSyncTypes() on its own -- three published jobs deliberately
  // have no entry here, because the backend registers no individual POST route for them. So
  // this pins the map to "every published job that HAS a route", parsed from the same file, and
  // as strict equality: a key with no route would send a POST that 404s, and a route with no
  // key is a job whose card can never be run.
  it('has an entry for exactly the published jobs with an individual POST route', () => {
    const routes = getBackendSyncPostRouteSegments()
    const runnableIds = getBackendSyncJobIds().filter((id) =>
      routes.includes(id.replace(/_/g, '-'))
    )

    // Not vacuous in either direction: some published jobs have a route, some do not.
    expect(runnableIds.length).toBeGreaterThan(0)
    expect(runnableIds.length).toBeLessThan(getBackendSyncJobIds().length)

    expect(Object.keys(SYNC_TYPE_NAMES).sort()).toEqual(runnableIds.slice().sort())
  })
})

// Plan Review Focus 1: after the Oct 15 rollover staff keep working the prior season. A card run
// (or Jotform's Pull now) while viewing it must sync that season, so the season reaches the URL
// -- only when it is not the primary (the status payload's `_configured_year`), so a primary
// run's request is exactly what it always was.
describe('useRunIndividualSync', () => {
  let client: QueryClient
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.syncStatus(), { _configured_year: 2027 })
    send.mockReset()
    send.mockResolvedValue({ status: 'started' })
  })

  it('runs the season being viewed when it is not the primary', async () => {
    const { result } = renderHook(() => useRunIndividualSync(), { wrapper })
    await act(() => result.current.mutateAsync({ syncType: 'jotform_submissions', year: 2026 }))
    expect(send).toHaveBeenCalledWith('/api/custom/sync/jotform-submissions?year=2026', {
      method: 'POST',
    })
  })

  it('sends no year for the primary, or when none is given', async () => {
    const { result } = renderHook(() => useRunIndividualSync(), { wrapper })
    await act(() => result.current.mutateAsync({ syncType: 'attendees', year: 2027 }))
    await act(() => result.current.mutateAsync({ syncType: 'attendees' }))
    expect(send).toHaveBeenNthCalledWith(1, '/api/custom/sync/attendees', { method: 'POST' })
    expect(send).toHaveBeenNthCalledWith(2, '/api/custom/sync/attendees', { method: 'POST' })
  })
})
