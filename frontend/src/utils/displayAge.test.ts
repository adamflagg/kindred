/**
 * Tests for getDisplayAge utility
 *
 * Option C implementation:
 * - Current year: use stored person.age from CampMinder sync
 * - Historical years: calculate from birthdate - yearDiff
 *
 * This ensures:
 * - Current year shows CampMinder-authoritative age
 * - Historical views always show age accurate to viewing date
 * - CampMinder format (years.months) is preserved
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDisplayAge, getActiveYear } from './displayAge';

describe('getDisplayAge', () => {
  // Mock date to January 7, 2026 for consistent testing
  const MOCK_DATE = new Date('2026-01-07T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('current year viewing (uses stored age)', () => {
    it('returns stored age when viewing active year', () => {
      const person = {
        age: 15.03,
        birthdate: '2010-10-15',
      };
      const viewingYear = 2025; // Active camp year (Jan 2026 = 2025 season)
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      expect(result).toBe(15.03);
    });

    it('returns null when stored age is missing and no birthdate', () => {
      const person = {
        age: undefined,
        birthdate: undefined,
      };
      const viewingYear = 2025;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      expect(result).toBeNull();
    });

    it('falls back to calculating from birthdate if stored age is missing', () => {
      const person = {
        age: undefined,
        birthdate: '2010-10-15', // Would be 15.02 on Jan 7, 2026
      };
      const viewingYear = 2025;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // 15 years, 2 months (Oct 15, 2010 to Jan 7, 2026)
      expect(result).toBe(15.02);
    });
  });

  describe('historical year viewing (calculates dynamically)', () => {
    it('calculates age for 1 year ago', () => {
      const person = {
        age: 15.03, // Stored age (ignored for historical)
        birthdate: '2010-10-15',
      };
      const viewingYear = 2024;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // Current age is 15.02, minus 1 year = 14.02
      expect(result).toBe(14.02);
    });

    it('calculates age for 2 years ago', () => {
      const person = {
        age: 15.03,
        birthdate: '2010-10-15',
      };
      const viewingYear = 2023;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // Current age is 15.02, minus 2 years = 13.02
      expect(result).toBe(13.02);
    });

    it('returns null when birthdate is missing for historical view', () => {
      const person = {
        age: 15.03,
        birthdate: undefined,
      };
      const viewingYear = 2024;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      expect(result).toBeNull();
    });

    it('handles year rollover correctly (15.11 - 1 = 14.11)', () => {
      // Camper born in February, viewing in January
      const person = {
        age: 14.11,
        birthdate: '2011-02-15', // 14 years, 10 months on Jan 7, 2026
      };
      const viewingYear = 2024;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // Current age 14.10, minus 1 year = 13.10
      expect(result).toBe(13.1);
    });
  });

  describe('CampMinder format preservation', () => {
    it('maintains years.months format (not decimal years)', () => {
      const person = {
        age: 12.06,
        birthdate: '2013-07-15', // 12 years, 5 months on Jan 7, 2026
      };
      const viewingYear = 2024;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // 12.05 - 1 = 11.05 (not 11.049999...)
      expect(result).toBe(11.05);
    });

    it('handles month values 00-11 correctly', () => {
      const person = {
        age: 10.0,
        birthdate: '2016-01-07', // Exactly 10.00 on Jan 7, 2026
      };
      const viewingYear = 2025;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      expect(result).toBe(10.0);
    });
  });

  describe('edge cases', () => {
    it('handles viewing future year (should not happen but be safe)', () => {
      const person = {
        age: 15.03,
        birthdate: '2010-10-15',
      };
      const viewingYear = 2026; // Future year
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // Should calculate: 15.02 + 1 = 16.02 (or handle gracefully)
      expect(result).toBe(16.02);
    });

    it('handles very young camper (6 years old)', () => {
      const person = {
        age: 6.03,
        birthdate: '2019-10-15',
      };
      const viewingYear = 2024;
      const activeYear = 2025;

      const result = getDisplayAge(person, viewingYear, activeYear);

      // 6.02 - 1 = 5.02
      expect(result).toBe(5.02);
    });
  });
});

describe('getActiveYear', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns previous calendar year in January-May (pre-summer)', () => {
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    expect(getActiveYear()).toBe(2025);
  });

  it('returns current calendar year in June-December (summer/post-summer)', () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
    expect(getActiveYear()).toBe(2026);
  });

  it('returns current calendar year in December', () => {
    vi.setSystemTime(new Date('2025-12-15T12:00:00Z'));
    expect(getActiveYear()).toBe(2025);
  });

  it('returns previous calendar year in May (last pre-summer month)', () => {
    vi.setSystemTime(new Date('2026-05-31T12:00:00Z'));
    expect(getActiveYear()).toBe(2025);
  });

  it('returns current calendar year in June (first summer month)', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    expect(getActiveYear()).toBe(2026);
  });
});
