import { describe, it, expect } from 'vitest'
import { PersonsRecordSchema } from './camper'

const MINIMAL_VALID_RECORD = {
  cm_id: 1000001,
  first_name: 'Emma',
  last_name: 'Johnson',
  year: 2026,
}

describe('PersonsRecordSchema', () => {
  // normalized_city is the field personLocation (utils/addressUtils.ts) reads
  // first (kindred#2755). address_city/address_state were already here;
  // normalized_city was missing, so a caller that `.parse()`s a real persons
  // response through this schema would silently have it stripped -- Zod
  // drops unknown keys by default -- and personLocation would fall back to
  // composing address_city + address_state even when normalized_city was
  // present on the wire.
  it('keeps normalized_city when present', () => {
    const result = PersonsRecordSchema.safeParse({
      ...MINIMAL_VALID_RECORD,
      normalized_city: 'Oakland, CA',
    })
    expect(result.success).toBe(true)
    expect(result.data?.normalized_city).toBe('Oakland, CA')
  })

  it('accepts a record without normalized_city (field is optional)', () => {
    const result = PersonsRecordSchema.safeParse(MINIMAL_VALID_RECORD)
    expect(result.success).toBe(true)
    expect(result.data?.normalized_city).toBeUndefined()
  })
})
