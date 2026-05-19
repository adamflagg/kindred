/**
 * Tests for shared source field color utility (#682).
 *
 * Verifies known source-field mappings and fallback classes.
 */
import { describe, it, expect } from 'vitest'
import { getSourceFieldClasses } from './sourceFieldColors'

describe('getSourceFieldClasses', () => {
  it.each([
    [
      'bunk_request_form',
      'bg-forest-100 text-forest-700 dark:bg-forest-900/40 dark:text-forest-400',
    ],
    ['staff_not_bunk_with', 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400'],
    ['bunking_notes', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'],
    ['internal_notes', 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400'],
    ['socialize_with', 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'],
  ])('returns correct classes for %s', (field, expected) => {
    expect(getSourceFieldClasses(field)).toBe(expected)
  })

  it('returns default classes for unknown fields', () => {
    expect(getSourceFieldClasses('unknown_field')).toBe(
      'bg-bark-100 text-bark-600 dark:bg-bark-800 dark:text-bark-400'
    )
  })
})
