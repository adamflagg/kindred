import { describe, it, expect } from 'vitest'
import { isMaterialRequest, IMMATERIAL_SOURCE_FIELDS } from './requestBucket'

describe('isMaterialRequest', () => {
  it.each([
    ['bunk_with', true],
    ['not_bunk_with', true],
    ['bunking_notes', true],
    ['internal_notes', true],
    ['socialize_with', false],
  ])('returns %s for source_field=%s', (sf, expected) => {
    expect(isMaterialRequest({ source_field: sf })).toBe(expected)
  })

  it('fail-open: returns true when source_field is missing', () => {
    // Different semantic from Python is_material_parent_request — frontend
    // helper answers "should this row be visible?" so unknown → yes-show.
    expect(isMaterialRequest({})).toBe(true)
    expect(isMaterialRequest({ source_field: null })).toBe(true)
    expect(isMaterialRequest({ source_field: undefined })).toBe(true)
  })

  it('fail-open: returns true for unknown source_field', () => {
    expect(isMaterialRequest({ source_field: 'new_unknown_field' })).toBe(true)
  })

  it('IMMATERIAL_SOURCE_FIELDS contains exactly socialize_with', () => {
    expect([...IMMATERIAL_SOURCE_FIELDS]).toEqual(['socialize_with'])
  })
})
