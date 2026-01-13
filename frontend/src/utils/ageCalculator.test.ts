/**
 * Tests for age calculator utility
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateAge } from './ageCalculator';

describe('calculateAge', () => {
  beforeEach(() => {
    // Mock Date to a fixed point: January 15, 2025
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15)); // Month is 0-indexed
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate age for a birthday earlier this year', () => {
    // Born January 1, 2015 = 10 years, 0 months (birthday already passed)
    expect(calculateAge('2015-01-01')).toBe(10.0);
  });

  it('should calculate age with months for birthday not yet reached', () => {
    // Born March 15, 2015 = 9 years, 10 months (birthday not reached yet)
    // Jan 15 - March 15 = -2 months, so 9 years + 10 months = 9.10
    expect(calculateAge('2015-03-15')).toBe(9.1);
  });

  it('should handle same day birthday', () => {
    // Born January 15, 2015 = exactly 10 years old today
    expect(calculateAge('2015-01-15')).toBe(10.0);
  });

  it('should handle birthday yesterday (just turned)', () => {
    // Born January 14, 2015 = 10 years, 0 months
    expect(calculateAge('2015-01-14')).toBe(10.0);
  });

  it('should calculate fractional months correctly', () => {
    // Born February 15, 2014 = 10 years, 11 months
    expect(calculateAge('2014-02-15')).toBe(10.11);
  });

  it('should handle year boundary', () => {
    // Born December 15, 2014 = 10 years, 1 month
    expect(calculateAge('2014-12-15')).toBe(10.01);
  });

  it('should handle very young ages', () => {
    // Born December 15, 2024 = 0 years, 1 month
    expect(calculateAge('2024-12-15')).toBe(0.01);
  });

  it('should handle future birthdays in current year', () => {
    // Born December 15, 2015 = 9 years, 1 month
    // Because Dec 15 hasn't happened yet in 2025
    expect(calculateAge('2015-12-15')).toBe(9.01);
  });
});
