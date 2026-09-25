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
      // The camper journey: one server read since kindred#2776, which retired
      // the 'person-records' and 'person-housing' client reads it used to wait
      // on. 'household-journey' stays for the weekend board's household card,
      // which reads it directly. The dead 'camper-history' key is gone too.
      'camper-journey',
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
      // kindred#2759: a completed Jotform pull refreshes the admin tab.
      'jotform',
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

  // kindred#2803: the server clears its weekend cache only for a sync that writes a
  // table the cache holds, so it has to be told which sync completed. The hourly
  // `bunk_assignments` sync used to wipe it for every open tab.
  it('names the completed sync so the server can scope what it clears', () => {
    invalidateSyncData('bunk_assignments')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/metrics/cache/invalidate?sync_type=bunk_assignments',
      { method: 'POST' }
    )
  })

  it('still invalidates every sync-dependent query key when a sync is named', () => {
    invalidateSyncData('bunk_assignments')
    const invalidatedPrefixes = spy.mock.calls.map(
      (call: unknown[]) => (call[0] as { queryKey: string[] }).queryKey[0]
    )
    expect(invalidatedPrefixes).toContain('weekend-roster')
    expect(invalidatedPrefixes).toContain('weekend-summary')
  })
})
