import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { queryClient, invalidateSyncData } from './queryClient'

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}))

describe('invalidateSyncData', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('invalidates all sync-dependent query key prefixes', () => {
    invalidateSyncData()

    const invalidatedPrefixes = spy.mock.calls.map(
      (call: unknown[]) => (call[0] as { queryKey: string[] }).queryKey[0]
    )

    // Every prefix that depends on synced CampMinder data must be invalidated.
    // Note: velocity, forecast, day1 use ['metrics', ...] prefix in queryKeys.ts,
    // so 'metrics' covers them. 'bunk-staff' is its own separate prefix.
    const requiredPrefixes = [
      'sessions',
      'all-sessions',
      'session',
      'session-stats',
      'session-groups',
      'session-programs',
      'campers',
      'all-campers',
      'camper',
      'enrolled-campers',
      // Adult camper journey (controller ruling, 2026-09-22): the shared journey
      // feed and every read it waits on. 'household-journey' is here too, because
      // the feed's key carries the housing reads' dataUpdatedAt, so re-running it
      // against a stale household journey would defeat the refresh. The dead
      // 'camper-history' key it replaced is gone.
      'camper-journey',
      'person-records',
      'person-housing',
      'household-journey',
      // CR #4 (kindred#2753): the camper record's current-year rows read live
      // attendees/bunks, so a completed sync must invalidate this prefix too —
      // it was never on this list, so a sync never refreshed what it had just
      // written here.
      'camper-current-year-rows',
      'bunks',
      'bunk-assignments',
      'bunk-requests',
      'bunk-request-status',
      'historical-bunking',
      'bunk-staff',
      'metrics',
      'sync-status',
    ]

    for (const prefix of requiredPrefixes) {
      expect(invalidatedPrefixes, `Missing invalidation for '${prefix}'`).toContain(prefix)
    }
  })

  it('fires server-side cache invalidation', () => {
    invalidateSyncData()
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/metrics/cache/invalidate', {
      method: 'POST',
    })
  })
})
