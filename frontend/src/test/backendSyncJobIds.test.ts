import { describe, it, expect } from 'vitest'
import { getBackendSyncJobIds } from './backendSyncJobIds'

describe('getBackendSyncJobIds (kindred#2593)', () => {
  it('parses a non-empty list of job IDs from pocketbase/sync/api.go', () => {
    const ids = getBackendSyncJobIds()
    expect(ids.length).toBeGreaterThan(30)
  })

  it('includes known daily-sync job IDs', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('session_groups')
    expect(ids).toContain('persons')
    expect(ids).toContain('stranded_assignment_cleanup')
  })

  it('includes the three jobs published by #2591', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('person_custom_values_family_camp')
    expect(ids).toContain('household_custom_values_family_camp')
    expect(ids).toContain('reconcile_request_lifecycle')
  })

  it('includes multi_workbook_export, not the renamed google_sheets_export', () => {
    const ids = getBackendSyncJobIds()
    expect(ids).toContain('multi_workbook_export')
    expect(ids).not.toContain('google_sheets_export')
  })

  it('has no duplicate job IDs', () => {
    const ids = getBackendSyncJobIds()
    expect(new Set(ids).size).toBe(ids.length)
  })
})
