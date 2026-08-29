import { describe, it, expect } from 'vitest'
import { SYNC_TYPE_NAMES } from './useRunIndividualSync'
import { getBackendSyncJobIds, getBackendSyncPostRouteSegments } from '../test/backendSyncJobIds'

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
