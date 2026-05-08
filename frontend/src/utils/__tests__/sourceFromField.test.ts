/**
 * Tests for sourceFromField helper — Stage 1 of issue #1142.
 *
 * Pins the 5→2 deterministic mapping from source_field values to RequestSource.
 * Every classification is locked here so any future drift is caught immediately.
 */

import { describe, expect, it } from 'vitest'
import { safeSourceFromField, sourceFromField } from '../sourceFromField'

describe('sourceFromField', () => {
  describe('FAMILY classifications', () => {
    it('maps bunk_with to family', () => {
      expect(sourceFromField('bunk_with')).toBe('family')
    })

    it('maps socialize_with to family', () => {
      expect(sourceFromField('socialize_with')).toBe('family')
    })
  })

  describe('STAFF classifications', () => {
    it('maps not_bunk_with to staff', () => {
      expect(sourceFromField('not_bunk_with')).toBe('staff')
    })

    it('maps bunking_notes to staff', () => {
      expect(sourceFromField('bunking_notes')).toBe('staff')
    })

    it('maps internal_notes to staff', () => {
      expect(sourceFromField('internal_notes')).toBe('staff')
    })
  })

  describe('all 5 values pinned (parametric)', () => {
    const CASES: Array<[string, 'family' | 'staff']> = [
      ['bunk_with', 'family'],
      ['socialize_with', 'family'],
      ['not_bunk_with', 'staff'],
      ['bunking_notes', 'staff'],
      ['internal_notes', 'staff'],
    ]

    it.each(CASES)('sourceFromField(%s) === %s', (field, expected) => {
      expect(sourceFromField(field)).toBe(expected)
    })
  })

  describe('unknown input', () => {
    it('throws for unknown field name', () => {
      expect(() => sourceFromField('unknown_field')).toThrow('unknown source_field')
    })

    it('throws for empty string', () => {
      expect(() => sourceFromField('')).toThrow('unknown source_field')
    })
  })
})

describe('safeSourceFromField', () => {
  it('returns mapped value for known field', () => {
    expect(safeSourceFromField('bunk_with')).toBe('family')
    expect(safeSourceFromField('not_bunk_with')).toBe('staff')
  })

  it('returns null for unknown field instead of throwing', () => {
    expect(safeSourceFromField('unknown_field')).toBeNull()
  })

  it('returns null for empty string instead of throwing', () => {
    expect(safeSourceFromField('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(safeSourceFromField(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(safeSourceFromField(undefined)).toBeNull()
  })
})
