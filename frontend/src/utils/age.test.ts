/**
 * Tests for age utility functions
 */
import { describe, it, expect } from 'vitest';
import { formatAge, displayCampMinderAge } from './age';

describe('formatAge', () => {
  it('should format age with years and months', () => {
    expect(formatAge(11.06)).toBe('11 years, 6 months');
  });

  it('should format age with just years when months is 0', () => {
    expect(formatAge(10.00)).toBe('10 years');
    expect(formatAge(12)).toBe('12 years');
  });

  it('should use singular "month" for 1 month', () => {
    expect(formatAge(9.01)).toBe('9 years, 1 month');
  });

  it('should handle edge cases', () => {
    expect(formatAge(0)).toBe('0 years');
    expect(formatAge(0.11)).toBe('0 years, 11 months');
  });

  it('should round months correctly', () => {
    // CampMinder format uses .01 for 1 month, .02 for 2 months, etc.
    expect(formatAge(11.03)).toBe('11 years, 3 months');
    expect(formatAge(11.12)).toBe('11 years, 12 months');
  });
});

describe('displayCampMinderAge', () => {
  it('should display age with 2 decimal places', () => {
    expect(displayCampMinderAge(11.06)).toBe('11.06');
    expect(displayCampMinderAge(10)).toBe('10.00');
  });

  it('should handle edge cases', () => {
    expect(displayCampMinderAge(0)).toBe('0.00');
    expect(displayCampMinderAge(15.11)).toBe('15.11');
  });
});
