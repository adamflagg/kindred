/**
 * Tests for getDisplayAge utility
 *
 * Simplified implementation:
 * - Uses stored person.age with year adjustment based on current calendar year
 * - Falls back to birthdate calculation if stored age is missing
 * - Year adjustment: currentCalendarYear - viewingYear
 *
 * Data model: persons table stores same age (at sync time) for all years
 * Frontend adjusts for historical viewing by subtracting year difference
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDisplayAge, getDisplayAgeForYear } from './displayAge';

describe('getDisplayAge', () => {
  // Mock date to January 29, 2026 for consistent testing
  const MOCK_DATE = new Date('2026-01-29T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('current year viewing (no adjustment)', () => {
    it('returns stored age unchanged when viewing current year', () => {
      const person = {
        age: 15.04,
        birthdate: '2010-09-15',
      };
      const viewingYear = 2026; // Same as current calendar year

      const result = getDisplayAge(person, viewingYear);

      // yearDiff = 2026 - 2026 = 0, so age unchanged
      expect(result).toBe(15.04);
    });

    it('returns null when both age and birthdate are missing', () => {
      const person = {
        age: undefined,
        birthdate: undefined,
      };
      const viewingYear = 2026;

      const result = getDisplayAge(person, viewingYear);

      expect(result).toBeNull();
    });

    it('falls back to birthdate calculation if stored age is missing', () => {
      const person = {
        age: undefined,
        birthdate: '2010-09-29', // Would be 15.04 on Jan 29, 2026
      };
      const viewingYear = 2026;

      const result = getDisplayAge(person, viewingYear);

      // 15 years, 4 months (Sep 29, 2010 to Jan 29, 2026)
      expect(result).toBe(15.04);
    });
  });

  describe('historical year viewing (subtracts year difference)', () => {
    it('subtracts 1 year when viewing 1 year ago', () => {
      const person = {
        age: 15.04, // Stored age (current at sync time)
        birthdate: '2010-09-15',
      };
      const viewingYear = 2025;

      const result = getDisplayAge(person, viewingYear);

      // yearDiff = 2026 - 2025 = 1, so 15.04 - 1 = 14.04
      expect(result).toBe(14.04);
    });

    it('subtracts 2 years when viewing 2 years ago', () => {
      const person = {
        age: 15.04,
        birthdate: '2010-09-15',
      };
      const viewingYear = 2024;

      const result = getDisplayAge(person, viewingYear);

      // yearDiff = 2026 - 2024 = 2, so 15.04 - 2 = 13.04
      expect(result).toBe(13.04);
    });

    it('uses stored age for historical view (not birthdate)', () => {
      // This verifies we use stored age, not recalculate from birthdate
      const person = {
        age: 15.04, // Stored from sync
        birthdate: '2010-09-15',
      };
      const viewingYear = 2025;

      const result = getDisplayAge(person, viewingYear);

      // Should use stored age (15.04) - 1 = 14.04
      // NOT calculate from birthdate
      expect(result).toBe(14.04);
    });

    it('falls back to birthdate for historical if stored age is missing', () => {
      const person = {
        age: undefined,
        birthdate: '2010-09-29', // 15.04 as of Jan 29, 2026
      };
      const viewingYear = 2025;

      const result = getDisplayAge(person, viewingYear);

      // Calculate from birthdate: 15.04 - 1 = 14.04
      expect(result).toBe(14.04);
    });
  });

  describe('CampMinder format preservation (YY.MM)', () => {
    it('maintains years.months format after subtraction', () => {
      const person = {
        age: 12.06,
        birthdate: '2013-07-15',
      };
      const viewingYear = 2025;

      const result = getDisplayAge(person, viewingYear);

      // 12.06 - 1 = 11.06 (not 11.059999...)
      expect(result).toBe(11.06);
    });

    it('handles month value 00 correctly', () => {
      const person = {
        age: 10.0,
        birthdate: '2016-01-29',
      };
      const viewingYear = 2026;

      const result = getDisplayAge(person, viewingYear);

      expect(result).toBe(10.0);
    });

    it('rounds to 2 decimal places to avoid floating point issues', () => {
      const person = {
        age: 11.11,
        birthdate: '2014-02-15',
      };
      const viewingYear = 2024;

      const result = getDisplayAge(person, viewingYear);

      // 11.11 - 2 = 9.11 (clean, no floating point artifacts)
      expect(result).toBe(9.11);
    });
  });

  describe('edge cases', () => {
    it('handles viewing future year (adds to age)', () => {
      const person = {
        age: 15.04,
        birthdate: '2010-09-15',
      };
      const viewingYear = 2027; // Future year

      const result = getDisplayAge(person, viewingYear);

      // yearDiff = 2026 - 2027 = -1, so 15.04 - (-1) = 16.04
      expect(result).toBe(16.04);
    });

    it('handles very young camper', () => {
      const person = {
        age: 6.03,
        birthdate: '2019-10-15',
      };
      const viewingYear = 2024;

      const result = getDisplayAge(person, viewingYear);

      // 6.03 - 2 = 4.03
      expect(result).toBe(4.03);
    });

    it('handles age of 0 (stored as 0)', () => {
      const person = {
        age: 0,
        birthdate: undefined,
      };
      const viewingYear = 2025;

      const result = getDisplayAge(person, viewingYear);

      // 0 - 1 = -1 (edge case, but mathematically correct)
      expect(result).toBe(-1);
    });
  });
});

describe('getDisplayAgeForYear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a convenience wrapper for getDisplayAge', () => {
    const person = {
      age: 15.04,
      birthdate: '2010-09-15',
    };

    const result = getDisplayAgeForYear(person, 2026);

    expect(result).toBe(15.04);
  });

  it('works with historical years', () => {
    const person = {
      age: 15.04,
      birthdate: '2010-09-15',
    };

    const result = getDisplayAgeForYear(person, 2025);

    expect(result).toBe(14.04);
  });
});
