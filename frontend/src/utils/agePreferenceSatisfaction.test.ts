/**
 * Unit tests for age_preference satisfaction logic.
 *
 * Tests the core business logic:
 * - "prefer older" = PASS if has older kids OR no younger kids (all same grade or higher is OK)
 * - "prefer younger" = PASS if has younger kids OR no older kids (all same grade or lower is OK)
 */

import { describe, expect, it } from 'vitest';
import { isAgePreferenceSatisfied } from './agePreferenceSatisfaction';

describe('isAgePreferenceSatisfied', () => {
  // ==================== "OLDER" PREFERENCE TESTS ====================

  describe('older preference', () => {
    it('should be satisfied when bunk has older bunkmates', () => {
      // Timmy (3rd grade) with 4th and 5th graders
      const result = isAgePreferenceSatisfied(3, [4, 5], 'older');
      expect(result.satisfied).toBe(true);
      expect(result.detail.toLowerCase()).toContain('older');
    });

    it('should be satisfied when bunk has mix including older (even with younger)', () => {
      // Timmy (3rd grade) with 2nd, 3rd, and 4th graders
      // Has younger (2nd) but also has older (4th) -> PASS
      const result = isAgePreferenceSatisfied(3, [2, 3, 4], 'older');
      expect(result.satisfied).toBe(true);
      expect(result.detail.toLowerCase()).toContain('older');
    });

    it('should be satisfied when all bunkmates are same grade (no younger kids)', () => {
      // Timmy (3rd grade) with all 3rd graders
      const result = isAgePreferenceSatisfied(3, [3, 3, 3], 'older');
      expect(result.satisfied).toBe(true);
      expect(
        result.detail.toLowerCase().includes('same') ||
          result.detail.toLowerCase().includes('older')
      ).toBe(true);
    });

    it('should NOT be satisfied when bunk has only younger bunkmates', () => {
      // Timmy (3rd grade) with only 2nd graders
      const result = isAgePreferenceSatisfied(3, [2, 2], 'older');
      expect(result.satisfied).toBe(false);
      expect(result.detail.toLowerCase()).toContain('younger');
    });

    it('should NOT be satisfied when bunk has younger and same but no older', () => {
      // Timmy (3rd grade) with 2nd and 3rd graders (no 4th+)
      const result = isAgePreferenceSatisfied(3, [2, 3], 'older');
      expect(result.satisfied).toBe(false);
      expect(result.detail.toLowerCase()).toContain('younger');
    });

    it('should be satisfied when all bunkmates are higher grade', () => {
      // Timmy (3rd grade) with all 4th and 5th graders
      const result = isAgePreferenceSatisfied(3, [4, 4, 5], 'older');
      expect(result.satisfied).toBe(true);
    });
  });

  // ==================== "YOUNGER" PREFERENCE TESTS ====================

  describe('younger preference', () => {
    it('should be satisfied when bunk has younger bunkmates', () => {
      // Sarah (5th grade) with 3rd and 4th graders
      const result = isAgePreferenceSatisfied(5, [3, 4], 'younger');
      expect(result.satisfied).toBe(true);
      expect(result.detail.toLowerCase()).toContain('younger');
    });

    it('should be satisfied when bunk has mix including younger (even with older)', () => {
      // Sarah (5th grade) with 4th, 5th, and 6th graders
      // Has older (6th) but also has younger (4th) -> PASS
      const result = isAgePreferenceSatisfied(5, [4, 5, 6], 'younger');
      expect(result.satisfied).toBe(true);
      expect(result.detail.toLowerCase()).toContain('younger');
    });

    it('should be satisfied when all bunkmates are same grade (no older kids)', () => {
      // Sarah (5th grade) with all 5th graders
      const result = isAgePreferenceSatisfied(5, [5, 5, 5], 'younger');
      expect(result.satisfied).toBe(true);
      expect(
        result.detail.toLowerCase().includes('same') ||
          result.detail.toLowerCase().includes('younger')
      ).toBe(true);
    });

    it('should NOT be satisfied when bunk has only older bunkmates', () => {
      // Sarah (5th grade) with only 6th and 7th graders
      const result = isAgePreferenceSatisfied(5, [6, 7], 'younger');
      expect(result.satisfied).toBe(false);
      expect(result.detail.toLowerCase()).toContain('older');
    });

    it('should NOT be satisfied when bunk has older and same but no younger', () => {
      // Sarah (5th grade) with 5th and 6th graders (no 4th-)
      const result = isAgePreferenceSatisfied(5, [5, 6], 'younger');
      expect(result.satisfied).toBe(false);
      expect(result.detail.toLowerCase()).toContain('older');
    });

    it('should be satisfied when all bunkmates are lower grade', () => {
      // Sarah (5th grade) with all 3rd and 4th graders
      const result = isAgePreferenceSatisfied(5, [3, 3, 4], 'younger');
      expect(result.satisfied).toBe(true);
    });
  });

  // ==================== EDGE CASES ====================

  describe('edge cases', () => {
    it('should NOT be satisfied when there are no bunkmates', () => {
      const result = isAgePreferenceSatisfied(3, [], 'older');
      expect(result.satisfied).toBe(false);
      expect(result.detail.toLowerCase()).toContain('no bunkmates');
    });

    it('should be satisfied with single bunkmate at same grade (older preference)', () => {
      const result = isAgePreferenceSatisfied(3, [3], 'older');
      expect(result.satisfied).toBe(true);
    });

    it('should be satisfied with single bunkmate at same grade (younger preference)', () => {
      const result = isAgePreferenceSatisfied(3, [3], 'younger');
      expect(result.satisfied).toBe(true);
    });

    it('should handle kindergarten (grade 0) with older preference', () => {
      // Kindergartener prefers older
      const result = isAgePreferenceSatisfied(0, [1, 2], 'older');
      expect(result.satisfied).toBe(true);
    });

    it('should handle high grade (8th grade) with younger preference', () => {
      // 8th grader prefers younger
      const result = isAgePreferenceSatisfied(8, [6, 7], 'younger');
      expect(result.satisfied).toBe(true);
    });

    it('should return false for unknown preference (defensive code path)', () => {
      // This tests the defensive fallback at line 90.
      // TypeScript prevents invalid preferences at compile time,
      // but runtime could receive bad data from API/JSON.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = isAgePreferenceSatisfied(3, [3, 4], 'unknown' as any);
      expect(result.satisfied).toBe(false);
      expect(result.detail).toContain('Unknown preference');
    });
  });
});
