import { describe, it, expect } from 'vitest'
import { getSyncTypesByPhase, YEAR_SYNC_TYPES } from './syncTypes'

describe('syncTypes', () => {
  const currentYear = 2026

  it('includes orphan_reconciler in transform phase', () => {
    const transformJobs = getSyncTypesByPhase('transform', currentYear, currentYear)
    const ids = transformJobs.map((t) => t.id)
    expect(ids).toContain('orphan_reconciler')
  })

  it('orphan_reconciler is last in the transform phase group', () => {
    const transformJobs = getSyncTypesByPhase('transform', currentYear, currentYear)
    const ids = transformJobs.map((t) => t.id)
    const enrollmentIdx = ids.indexOf('enrollment_snapshots')
    const orphanIdx = ids.indexOf('orphan_reconciler')
    expect(orphanIdx).toBeGreaterThan(enrollmentIdx)
  })

  it('orphan_reconciler has a description clarifying PB-only', () => {
    const entry = YEAR_SYNC_TYPES.find((t) => t.id === 'orphan_reconciler')
    expect(entry).toBeDefined()
    expect('description' in entry!).toBe(true)
    if ('description' in entry!) {
      expect(entry.description).toMatch(/PB-only/i)
    }
  })

  it('orphan_reconciler is not currentYearOnly', () => {
    const entry = YEAR_SYNC_TYPES.find((t) => t.id === 'orphan_reconciler')
    expect(entry).toBeDefined()
    expect('currentYearOnly' in entry!).toBe(false)
  })
})
