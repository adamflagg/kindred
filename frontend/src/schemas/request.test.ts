import { describe, it, expect } from 'vitest'
import { BunkRequestsRecordSchema, BunkRequestsSourceSchema } from './request'

const MINIMAL_VALID_RECORD = {
  request_type: 'bunk_with' as const,
  requester_id: 12345,
  session_id: 1000002,
  status: 'pending' as const,
  year: 2025,
}

describe('BunkRequestsSourceSchema', () => {
  it('accepts family and staff', () => {
    expect(BunkRequestsSourceSchema.parse('family')).toBe('family')
    expect(BunkRequestsSourceSchema.parse('staff')).toBe('staff')
  })

  it('rejects legacy notes value (#1102)', () => {
    // 'notes' was removed from the schema; openai_provider already maps it to STAFF
    const result = BunkRequestsSourceSchema.safeParse('notes')
    expect(result.success).toBe(false)
  })
})

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
