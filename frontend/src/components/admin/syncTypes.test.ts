import { describe, it, expect } from 'vitest'
import {
  getSyncTypesByPhase,
  GLOBAL_SYNC_TYPES,
  hasManualTrigger,
  isCurrentYearOnly,
  YEAR_SYNC_TYPES,
} from './syncTypes'
import { getBackendSyncJobIds, getBackendSyncPostRouteSegments } from '../../test/backendSyncJobIds'

describe('syncTypes', () => {
  const currentYear = 2026

  it('includes stranded_assignment_cleanup in transform phase', () => {
    const transformJobs = getSyncTypesByPhase('transform', currentYear, currentYear)
    const ids = transformJobs.map((t) => t.id)
    expect(ids).toContain('stranded_assignment_cleanup')
  })

  it('stranded_assignment_cleanup is last in the transform phase group', () => {
    const transformJobs = getSyncTypesByPhase('transform', currentYear, currentYear)
    const ids = transformJobs.map((t) => t.id)
    const enrollmentIdx = ids.indexOf('enrollment_snapshots')
    const cleanupIdx = ids.indexOf('stranded_assignment_cleanup')
    expect(cleanupIdx).toBeGreaterThan(enrollmentIdx)
    expect(cleanupIdx).toBe(ids.length - 1)
  })

  it('stranded_assignment_cleanup has a description clarifying PB-only', () => {
    const entry = YEAR_SYNC_TYPES.find((t) => t.id === 'stranded_assignment_cleanup')
    expect(entry).toBeDefined()
    expect('description' in entry!).toBe(true)
    if ('description' in entry!) {
      expect(entry.description).toMatch(/PB-only/i)
    }
  })

  it('stranded_assignment_cleanup is not currentYearOnly', () => {
    const entry = YEAR_SYNC_TYPES.find((t) => t.id === 'stranded_assignment_cleanup')
    expect(entry).toBeDefined()
    expect('currentYearOnly' in entry!).toBe(false)
  })
})

// kindred#2593: SyncTab renders cards from GLOBAL_SYNC_TYPES/YEAR_SYNC_TYPES, and neither is
// derived from the backend's sync-status payload -- a job absent from both gets no card at
// all, not a card with a raw snake_case name. This anchors that coverage to the backend's own
// statusSyncTypes() (pocketbase/sync/api.go) instead of comparing frontend lists to each
// other, which would drift in lockstep and prove nothing.
describe('syncTypes backend coverage (kindred#2593)', () => {
  it('has a card for every job the backend publishes on the sync-status payload', () => {
    const backendIds = getBackendSyncJobIds().slice().sort()
    const cardIds = [...GLOBAL_SYNC_TYPES, ...YEAR_SYNC_TYPES].map((t) => t.id).sort()
    expect(cardIds).toEqual(backendIds)
  })
})

// kindred#2593: `manualTrigger: false` is the whole basis for rendering three cards without a
// Run button, and the PR states the reason as "the backend registers no individual POST route
// for these". That is a checkable fact about pocketbase/sync/api.go, not a judgement call, so
// check it -- both directions, so the flag can neither be forgotten on a routeless job nor
// left on one that later gains a route.
describe('manualTrigger tracks the backend route table (kindred#2593)', () => {
  it('is false for exactly the cards with no individual POST route', () => {
    const routes = getBackendSyncPostRouteSegments()
    const cards = [...GLOBAL_SYNC_TYPES, ...YEAR_SYNC_TYPES]
    const routeless = cards.filter((t) => !routes.includes(t.id.replace(/_/g, '-')))

    // Guards the assertion below against passing vacuously if the route parse ever returns
    // everything -- there really are cards with no route, and there really are cards with one.
    expect(routeless.length).toBeGreaterThan(0)
    expect(routeless.length).toBeLessThan(cards.length)

    expect(
      cards
        .filter((t) => !hasManualTrigger(t))
        .map((t) => t.id)
        .sort()
    ).toEqual(routeless.map((t) => t.id).sort())
  })
})

// kindred#2593: `currentYearOnly` gates both the card grid and the Full-mode service dropdown,
// and SyncTab's year-change reset used to name the flagged ids by hand -- a list that was
// already two short of the flag when this PR added three more entries carrying it. The
// predicate is the single reading of the flag; this pins it to the data.
describe('isCurrentYearOnly (kindred#2593)', () => {
  it('reports exactly the entries that carry the flag', () => {
    const flagged: string[] = YEAR_SYNC_TYPES.filter((t) => 'currentYearOnly' in t).map((t) => t.id)
    expect(flagged.length).toBeGreaterThan(0)

    for (const syncType of YEAR_SYNC_TYPES) {
      expect(isCurrentYearOnly(syncType)).toBe(flagged.includes(syncType.id))
    }
  })
})
