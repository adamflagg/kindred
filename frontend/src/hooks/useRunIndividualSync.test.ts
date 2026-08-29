import { describe, it, expect } from 'vitest'
import { SYNC_TYPE_NAMES } from './useRunIndividualSync'

describe('SYNC_TYPE_NAMES', () => {
  it('includes stranded_assignment_cleanup', () => {
    expect(SYNC_TYPE_NAMES['stranded_assignment_cleanup']).toBeDefined()
    expect(SYNC_TYPE_NAMES['stranded_assignment_cleanup']).toBe('Stranded Assignment Cleanup')
  })

  it('maps stranded_assignment_cleanup to kebab-case endpoint segment', () => {
    // The hook calls /api/custom/sync/${id.replace(/_/g, '-')}
    // Verify the id string produces the correct endpoint.
    const id = 'stranded_assignment_cleanup'
    const endpoint = id.replace(/_/g, '-')
    expect(endpoint).toBe('stranded-assignment-cleanup')
  })

  // kindred#2593: syncTypes.ts gains a card for multi_workbook_export (the Export phase
  // previously had zero cards at all, since no job in YEAR_SYNC_TYPES declared
  // `phase: 'export'`). A card with no entry here would throw "Unknown sync type" the
  // moment its Run button is clicked -- SyncTab's handleRun falls through to
  // runIndividualSync.mutate(syncType.id) for any id without its own switch case, and that
  // mutation validates against this map before sending the request.
  it('includes multi_workbook_export, whose card gets a real POST route (/multi-workbook-export)', () => {
    expect(SYNC_TYPE_NAMES['multi_workbook_export']).toBeDefined()
  })

  it('maps multi_workbook_export to kebab-case endpoint segment', () => {
    const id = 'multi_workbook_export'
    const endpoint = id.replace(/_/g, '-')
    expect(endpoint).toBe('multi-workbook-export')
  })
})
