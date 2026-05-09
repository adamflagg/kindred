import { describe, it, expect } from 'vitest'
import { BunkRequestsRecordSchema } from './request'

const MINIMAL_VALID_RECORD = {
  request_type: 'bunk_with' as const,
  requester_id: 12345,
  session_id: 1000002,
  status: 'pending' as const,
  year: 2025,
}

describe('BunkRequestsRecordSchema', () => {
  it('preserves source_fragment when present', () => {
    const result = BunkRequestsRecordSchema.safeParse({
      ...MINIMAL_VALID_RECORD,
      source_fragment: 'wants to be with Emma Johnson',
    })
    expect(result.success).toBe(true)
    expect(result.data?.source_fragment).toBe('wants to be with Emma Johnson')
  })

  it('accepts a record without source_fragment (field is optional)', () => {
    const result = BunkRequestsRecordSchema.safeParse(MINIMAL_VALID_RECORD)
    expect(result.success).toBe(true)
    expect(result.data?.source_fragment).toBeUndefined()
  })

  it('accepts an empty string as source_fragment', () => {
    const result = BunkRequestsRecordSchema.safeParse({
      ...MINIMAL_VALID_RECORD,
      source_fragment: '',
    })
    expect(result.success).toBe(true)
    expect(result.data?.source_fragment).toBe('')
  })
})
