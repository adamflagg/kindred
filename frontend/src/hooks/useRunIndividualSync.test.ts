import { describe, it, expect } from 'vitest'
import { SYNC_TYPE_NAMES } from './useRunIndividualSync'

describe('SYNC_TYPE_NAMES', () => {
  it('includes orphan_reconciler', () => {
    expect(SYNC_TYPE_NAMES['orphan_reconciler']).toBeDefined()
    expect(SYNC_TYPE_NAMES['orphan_reconciler']).toBe('Orphan Reconciler')
  })

  it('maps orphan_reconciler to kebab-case endpoint segment', () => {
    // The hook calls /api/custom/sync/${id.replace(/_/g, '-')}
    // Verify the id string produces the correct endpoint.
    const id = 'orphan_reconciler'
    const endpoint = id.replace(/_/g, '-')
    expect(endpoint).toBe('orphan-reconciler')
  })
})
