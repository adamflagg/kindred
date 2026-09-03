/**
 * Tests for grade utility functions
 */
import { describe, it, expect } from 'vitest'
import { formatGradeOrdinal } from './gradeUtils'

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
  ])('formats %s to %s', (input, expected) => {
    expect(formatGradeOrdinal(input)).toBe(expected)
  })
})
