/**
 * Tests for SOURCE_FIELD_OPTIONS export and derived fieldLabels (#808).
 *
 * Verifies that SOURCE_FIELD_OPTIONS is the single source of truth
 * and that buildFieldLabelMap correctly derives a Record lookup from it.
 */
import { describe, it, expect } from 'vitest'
import { SOURCE_FIELD_OPTIONS, buildFieldLabelMap } from './sourceFieldLabels'

describe('SOURCE_FIELD_OPTIONS', () => {
  it('contains exactly 5 source field options', () => {
    expect(SOURCE_FIELD_OPTIONS).toHaveLength(5)
  })

  it.each([
    ['bunk_request_form', 'Bunk With'],
    ['staff_not_bunk_with', 'Not Bunk With'],
    ['bunking_notes', 'Bunking Notes'],
    ['internal_notes', 'Internal Notes'],
    ['socialize_with', 'Socialize With'],
  ])('includes %s with label "%s"', (value, label) => {
    const option = SOURCE_FIELD_OPTIONS.find((o) => o.value === value)
    expect(option).toBeDefined()
    expect(option?.label).toBe(label)
  })
})

describe('buildFieldLabelMap', () => {
  it('returns a Record mapping every value to its label', () => {
    const map = buildFieldLabelMap()
    expect(map).toEqual({
      bunk_request_form: 'Bunk With',
      staff_not_bunk_with: 'Not Bunk With',
      bunking_notes: 'Bunking Notes',
      internal_notes: 'Internal Notes',
      socialize_with: 'Socialize With',
    })
  })

  it('has the same number of keys as SOURCE_FIELD_OPTIONS entries', () => {
    const map = buildFieldLabelMap()
    expect(Object.keys(map)).toHaveLength(SOURCE_FIELD_OPTIONS.length)
  })
})
