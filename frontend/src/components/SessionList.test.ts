import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBefore, isAfter, isWithinInterval, startOfDay, formatDistanceToNow } from 'date-fns';

/**
 * Helper to create date strings that parse as LOCAL midnight.
 * JavaScript parses 'YYYY-MM-DD' as UTC, but 'YYYY-MM-DDTHH:mm:ss' as local.
 */
function localDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}T00:00:00`;
}

// Test the getSessionStatus logic from SessionList
// This tests date-fns integration for session status determination
function getSessionStatus(startDate: string, endDate: string): 'upcoming' | 'in-progress' | 'completed' {
  const today = startOfDay(new Date());
  const start = startOfDay(new Date(startDate));
  const end = startOfDay(new Date(endDate));

  if (isBefore(today, start)) return 'upcoming';
  if (isAfter(today, end)) return 'completed';
  if (isWithinInterval(today, { start, end })) return 'in-progress';
  return 'upcoming';
}

describe('SessionList date logic', () => {
  describe('getSessionStatus', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Set to June 15, 2025 noon LOCAL time
      vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "upcoming" for future sessions', () => {
      expect(getSessionStatus(localDate(2025, 7, 1), localDate(2025, 7, 14))).toBe('upcoming');
    });

    it('should return "completed" for past sessions', () => {
      expect(getSessionStatus(localDate(2025, 5, 1), localDate(2025, 5, 14))).toBe('completed');
    });

    it('should return "in-progress" for current sessions', () => {
      expect(getSessionStatus(localDate(2025, 6, 10), localDate(2025, 6, 20))).toBe('in-progress');
    });

    it('should handle session starting today', () => {
      // Today is June 15, session starts June 15 = in-progress
      expect(getSessionStatus(localDate(2025, 6, 15), localDate(2025, 6, 28))).toBe('in-progress');
    });

    it('should handle session ending today', () => {
      // Today is June 15, session ends June 15 = in-progress (last day)
      expect(getSessionStatus(localDate(2025, 6, 1), localDate(2025, 6, 15))).toBe('in-progress');
    });

    it('should handle session ending tomorrow', () => {
      expect(getSessionStatus(localDate(2025, 6, 1), localDate(2025, 6, 16))).toBe('in-progress');
    });

    it('should handle session ended yesterday', () => {
      // Today is June 15, session ended June 14 = completed
      expect(getSessionStatus(localDate(2025, 6, 1), localDate(2025, 6, 14))).toBe('completed');
    });

    it('should handle session starting tomorrow', () => {
      // Today is June 15, session starts June 16 = upcoming
      expect(getSessionStatus(localDate(2025, 6, 16), localDate(2025, 6, 28))).toBe('upcoming');
    });

    it('should handle single-day sessions (same start and end date)', () => {
      // Today's single-day session = in-progress
      expect(getSessionStatus(localDate(2025, 6, 15), localDate(2025, 6, 15))).toBe('in-progress');
      // Yesterday's single-day session = completed
      expect(getSessionStatus(localDate(2025, 6, 14), localDate(2025, 6, 14))).toBe('completed');
      // Tomorrow's single-day session = upcoming
      expect(getSessionStatus(localDate(2025, 6, 17), localDate(2025, 6, 17))).toBe('upcoming');
    });
  });

  describe('date-fns formatDistanceToNow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should format relative time correctly', () => {
      const pastDate = new Date(2025, 5, 14, 12, 0, 0);
      expect(formatDistanceToNow(pastDate, { addSuffix: true })).toBe('1 day ago');

      const futureDate = new Date(2025, 5, 16, 12, 0, 0);
      expect(formatDistanceToNow(futureDate, { addSuffix: true })).toBe('in 1 day');
    });
  });
});
