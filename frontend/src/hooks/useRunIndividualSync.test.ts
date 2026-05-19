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
})
