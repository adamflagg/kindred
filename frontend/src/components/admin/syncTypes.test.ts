import { describe, it, expect } from 'vitest'
import { getSyncTypesByPhase, GLOBAL_SYNC_TYPES, YEAR_SYNC_TYPES } from './syncTypes'
import { getBackendSyncJobIds } from '../../test/backendSyncJobIds'

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
