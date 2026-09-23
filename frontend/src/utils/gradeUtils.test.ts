/**
 * Tests for grade utility functions
 */
import { describe, it, expect } from 'vitest'
import { formatGradeName, formatGradeOrdinal, visibleGradeName } from './gradeUtils'

describe('formatGradeOrdinal', () => {
  it.each<[number | string | undefined | null, string]>([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [5, '5th'],
    [6, '6th'],
    [7, '7th'],
    [8, '8th'],
    [9, '9th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [24, '24th'],
    ['5', '5th'],
    ['1', '1st'],
    [undefined, '?'],
    [null, '?'],
    ['', '?'],
    ['K', 'K'],
    ['Pre-K', 'Pre-K'],
    // kindred#2779: Pre-K .. Infant store -1 .. -4. The number has no ordinal,
    // so it prints nothing rather than "-1th"; K (0) is untouched.
    [-1, ''],
    [-4, ''],
    [0, '0th'],
  ])('formats %s to %s', (input, expected) => {
    expect(formatGradeOrdinal(input)).toBe(expected)
  })
})

// kindred#2779: `persons.grade_name` is what is displayed. Ordinals read as
// "Nth Grade"; K and everything below it read as CampMinder names them; an
// empty name means no grade at all and renders nothing.
describe('formatGradeName', () => {
  it.each<[string | null | undefined, string | null]>([
    ['1st', '1st Grade'],
    ['5th', '5th Grade'],
    ['12th', '12th Grade'],
    ['12th+', '12th+ Grade'],
    ['K', 'K'],
    ['Pre-K', 'Pre-K'],
    ['Nursery', 'Nursery'],
    ['Toddler', 'Toddler'],
    ['Infant', 'Infant'],
    ['', null],
    [null, null],
    [undefined, null],
  ])('formats %s to %s', (input, expected) => {
    expect(formatGradeName(input)).toBe(expected)
  })
})

// Owner ruling 2026-09-23 (#2782): no grade shows for anyone 21 or older
// (ADULT_AGE). CampMinder keeps advancing a former camper's grade until it
// reaches 12th+, so an adult can carry a stale one.
describe('the 21+ gate', () => {
  it.each<[string, number | null | undefined, string | null]>([
    ['12th+', 33.06, null],
    ['6th', 23.06, null],
    ['12th+', 21, null],
    ['12th+', 20.11, '12th+'],
    ['12th+', 18.04, '12th+'],
    ['K', 5.06, 'K'],
    ['5th', null, '5th'],
    ['5th', undefined, '5th'],
  ])('visibleGradeName(%s, age %s) is %s', (name, age, expected) => {
    expect(visibleGradeName(name, age)).toBe(expected)
  })

  it('formatGradeName applies the same gate', () => {
    expect(formatGradeName('12th+', 33.06)).toBeNull()
    expect(formatGradeName('12th+', 18.04)).toBe('12th+ Grade')
  })
})
