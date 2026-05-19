import { describe, expect, it } from 'vitest'
import { SourceField } from './sourceField'

describe('SourceField const', () => {
  it('exposes new wire-format values for the two disambiguated fields', () => {
    expect(SourceField.BUNK_REQUEST_FORM).toBe('bunk_request_form')
    expect(SourceField.STAFF_NOT_BUNK_WITH).toBe('staff_not_bunk_with')
  })

  it('exposes unchanged values for the three unambiguous fields', () => {
    expect(SourceField.BUNKING_NOTES).toBe('bunking_notes')
    expect(SourceField.INTERNAL_NOTES).toBe('internal_notes')
    expect(SourceField.SOCIALIZE_WITH).toBe('socialize_with')
    expect(SourceField.MANUAL).toBe('manual')
  })
})
