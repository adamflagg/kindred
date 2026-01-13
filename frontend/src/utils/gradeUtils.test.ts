/**
 * Tests for grade utility functions
 */
import { describe, it, expect } from 'vitest';
import { formatGradeOrdinal } from './gradeUtils';

describe('formatGradeOrdinal', () => {
  it('should format 1st, 2nd, 3rd correctly', () => {
    expect(formatGradeOrdinal(1)).toBe('1st');
    expect(formatGradeOrdinal(2)).toBe('2nd');
    expect(formatGradeOrdinal(3)).toBe('3rd');
  });

  it('should format 4th-10th correctly', () => {
    expect(formatGradeOrdinal(4)).toBe('4th');
    expect(formatGradeOrdinal(5)).toBe('5th');
    expect(formatGradeOrdinal(6)).toBe('6th');
    expect(formatGradeOrdinal(7)).toBe('7th');
    expect(formatGradeOrdinal(8)).toBe('8th');
    expect(formatGradeOrdinal(9)).toBe('9th');
    expect(formatGradeOrdinal(10)).toBe('10th');
  });

  it('should format 11th, 12th, 13th with "th" suffix', () => {
    // Special case: 11, 12, 13 all end in "th"
    expect(formatGradeOrdinal(11)).toBe('11th');
    expect(formatGradeOrdinal(12)).toBe('12th');
    expect(formatGradeOrdinal(13)).toBe('13th');
  });

  it('should handle larger numbers correctly', () => {
    expect(formatGradeOrdinal(21)).toBe('21st');
    expect(formatGradeOrdinal(22)).toBe('22nd');
    expect(formatGradeOrdinal(23)).toBe('23rd');
    expect(formatGradeOrdinal(24)).toBe('24th');
  });

  it('should handle string input', () => {
    expect(formatGradeOrdinal('5')).toBe('5th');
    expect(formatGradeOrdinal('1')).toBe('1st');
  });

  it('should return "?" for undefined, null, or empty string', () => {
    expect(formatGradeOrdinal(undefined)).toBe('?');
    expect(formatGradeOrdinal(null)).toBe('?');
    expect(formatGradeOrdinal('')).toBe('?');
  });

  it('should return original value for non-numeric strings', () => {
    expect(formatGradeOrdinal('K')).toBe('K');
    expect(formatGradeOrdinal('Pre-K')).toBe('Pre-K');
  });
});
