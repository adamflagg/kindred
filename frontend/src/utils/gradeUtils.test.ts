/**
 * Tests for grade utility functions
 */
import { describe, it, expect } from 'vitest'
import { formatGradeName, formatGradeOrdinal } from './gradeUtils'

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
    // 13 is past 12th grade (CampMinder's "12th+"): owner ruling 2026-09-23.
    [13, 'Grad'],
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

// kindred#2779 + owner rulings 2026-09-23: `persons.grade_name` is what is
// displayed, in two styles. SHORT for tight spaces (side panel, sibling rows,
// weekend panels); LONG for the full camper record. An empty name means no
// grade at all and renders nothing.
describe('formatGradeName', () => {
  it.each<[string | null | undefined, string | null, string | null]>([
    // name, short, long
    ['1st', '1st', '1st Grade'],
    ['5th', '5th', '5th Grade'],
    ['12th', '12th', '12th Grade'],
    ['12th+', 'Grad', 'Graduated'],
    ['K', 'K', 'Kindergarten'],
    ['Pre-K', 'Pre-K', 'Pre-K'],
    ['Nursery', 'Nursery', 'Nursery'],
    ['Toddler', 'Toddler', 'Toddler'],
    ['Infant', 'Infant', 'Infant'],
    ['', null, null],
    [null, null, null],
    [undefined, null, null],
  ])('formats %s as %s (short) / %s (long)', (input, short, long) => {
    expect(formatGradeName(input, 'short')).toBe(short)
    expect(formatGradeName(input, 'long')).toBe(long)
  })
})
