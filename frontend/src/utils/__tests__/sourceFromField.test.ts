/**
 * Tests for safeSourceFromField helper — Stage 1 of issue #1142.
 *
 * Pins the 5→2 deterministic mapping from source_field values to RequestSource.
 * Every classification is locked here so any future drift is caught immediately.
 */

import { describe, expect, it } from 'vitest'
import { safeSourceFromField } from '../sourceFromField'

describe('safeSourceFromField', () => {
  describe('FAMILY classifications', () => {
    it('maps bunk_with to family', () => {
      expect(safeSourceFromField('bunk_with')).toBe('family')
    })

    it('maps socialize_with to family', () => {
      expect(safeSourceFromField('socialize_with')).toBe('family')
    })
  })

  describe('STAFF classifications', () => {
    it('maps not_bunk_with to staff', () => {
      expect(safeSourceFromField('not_bunk_with')).toBe('staff')
    })

    it('maps bunking_notes to staff', () => {
      expect(safeSourceFromField('bunking_notes')).toBe('staff')
    })

    it('maps internal_notes to staff', () => {
      expect(safeSourceFromField('internal_notes')).toBe('staff')
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

    it.each(CASES)('safeSourceFromField(%s) === %s', (field, expected) => {
      expect(safeSourceFromField(field)).toBe(expected)
    })
  })

  describe('unknown / empty input', () => {
    it('returns null for unknown field name', () => {
      expect(safeSourceFromField('unknown_field')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(safeSourceFromField('')).toBeNull()
    })

    it('returns null for null', () => {
      expect(safeSourceFromField(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(safeSourceFromField(undefined)).toBeNull()
    })
  })
})
