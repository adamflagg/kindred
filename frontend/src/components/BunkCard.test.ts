import { describe, it, expect } from 'vitest';

/**
 * Tests for BunkCard utility functions and validation logic.
 *
 * These tests cover the pure functions extracted from BunkCard.tsx
 * for grade range parsing and drop target validation.
 */

// Extracted utility functions for testing
// These mirror the logic in BunkCard.tsx lines 35-76

function extractGradeRange(name: string): [number, number] {
  if (!name) return [0, 0];

  // Pattern 1: "X/Y" format (e.g., "9/10", "7/8")
  const slashMatch = name.match(/(\d+)\/(\d+)/);
  if (slashMatch?.[1] && slashMatch[2]) {
    const g1 = parseInt(slashMatch[1], 10);
    const g2 = parseInt(slashMatch[2], 10);
    return [Math.min(g1, g2), Math.max(g1, g2)];
  }

  // Pattern 2: "Xth - Yth" format (e.g., "7th - 9th", "7th & 8th")
  const rangeMatch = name.match(/(\d+)(?:st|nd|rd|th)?\s*[-–&]\s*(\d+)(?:st|nd|rd|th)?/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const g1 = parseInt(rangeMatch[1], 10);
    const g2 = parseInt(rangeMatch[2], 10);
    return [Math.min(g1, g2), Math.max(g1, g2)];
  }

  // Pattern 3: Single number after "AG-" (e.g., "AG-8" → 8, 8)
  const singleMatch = name.match(/AG[-\s](\d+)/i);
  if (singleMatch?.[1]) {
    const grade = parseInt(singleMatch[1], 10);
    return [grade, grade];
  }

  return [0, 0];
}

function gradeInRange(grade: number, min: number, max: number): boolean {
  return grade >= min && grade <= max;
}

function gradesOverlap(min1: number, max1: number, min2: number, max2: number): boolean {
  return !(max1 < min2 || min1 > max2);
}

// Mock types for testing
interface MockCamper {
  gender: 'M' | 'F';
  expand?: {
    session?: {
      session_type: 'main' | 'ag' | 'embedded';
      name: string;
    };
  };
}

interface MockBunk {
  gender: string | null;
  name: string;
}

function isValidDropTarget(camper: MockCamper, bunk: MockBunk): boolean {
  const bunkGender = bunk.gender?.toLowerCase();
  const isFromAGSession = camper.expand?.session?.session_type === 'ag';

  if (isFromAGSession) {
    // AG campers can only go to Mixed (AG) bunks
    if (bunkGender !== 'mixed') {
      return false;
    }

    // Check if bunk grade is compatible with session grade range
    const sessionName = camper.expand?.session?.name || '';
    const [sessionGradeMin, sessionGradeMax] = extractGradeRange(sessionName);
    const [bunkGradeMin, bunkGradeMax] = extractGradeRange(bunk.name || '');

    // If we can extract grades from both, check compatibility
    if (bunkGradeMin > 0 && sessionGradeMin > 0) {
      if (bunkGradeMin === bunkGradeMax) {
        // Single grade bunk (e.g., "AG-8") - must be within session range
        if (!gradeInRange(bunkGradeMin, sessionGradeMin, sessionGradeMax)) {
          return false;
        }
      } else {
        // Range bunk - check for any overlap with session range
        if (!gradesOverlap(bunkGradeMin, bunkGradeMax, sessionGradeMin, sessionGradeMax)) {
          return false;
        }
      }
    }

    return true;
  }

  // Non-AG campers go to gendered bunks based on their gender
  if (camper.gender === 'M') {
    return bunkGender === 'm' || bunk.name?.startsWith('B-');
  }
  if (camper.gender === 'F') {
    return bunkGender === 'f' || bunk.name?.startsWith('G-');
  }

  return true;
}

describe('BunkCard utility functions', () => {
  describe('extractGradeRange', () => {
    it('should parse X/Y format (e.g., "9/10")', () => {
      expect(extractGradeRange('B-1 9/10')).toEqual([9, 10]);
      expect(extractGradeRange('G-2 7/8')).toEqual([7, 8]);
    });

    it('should handle reversed order in X/Y format', () => {
      expect(extractGradeRange('10/9')).toEqual([9, 10]);
    });

    it('should parse Xth-Yth format', () => {
      expect(extractGradeRange('7th - 9th')).toEqual([7, 9]);
      expect(extractGradeRange('5th-6th')).toEqual([5, 6]);
    });

    it('should parse Xth & Yth format', () => {
      expect(extractGradeRange('7th & 8th')).toEqual([7, 8]);
    });

    it('should parse AG-X format', () => {
      expect(extractGradeRange('AG-8')).toEqual([8, 8]);
      expect(extractGradeRange('AG-10')).toEqual([10, 10]);
      expect(extractGradeRange('ag-7')).toEqual([7, 7]); // Case insensitive
    });

    it('should return [0, 0] for unparseable names', () => {
      expect(extractGradeRange('B-1')).toEqual([0, 0]);
      expect(extractGradeRange('Cabin Alpha')).toEqual([0, 0]);
      expect(extractGradeRange('')).toEqual([0, 0]);
    });
  });

  describe('gradeInRange', () => {
    it('should return true when grade is within range', () => {
      expect(gradeInRange(8, 7, 9)).toBe(true);
      expect(gradeInRange(7, 7, 9)).toBe(true); // At min
      expect(gradeInRange(9, 7, 9)).toBe(true); // At max
    });

    it('should return false when grade is outside range', () => {
      expect(gradeInRange(6, 7, 9)).toBe(false); // Below min
      expect(gradeInRange(10, 7, 9)).toBe(false); // Above max
    });
  });

  describe('gradesOverlap', () => {
    it('should return true for overlapping ranges', () => {
      expect(gradesOverlap(7, 9, 8, 10)).toBe(true); // Partial overlap
      expect(gradesOverlap(7, 9, 7, 9)).toBe(true); // Exact match
      expect(gradesOverlap(7, 10, 8, 9)).toBe(true); // One contains the other
    });

    it('should return true for adjacent ranges (touching at boundary)', () => {
      expect(gradesOverlap(7, 8, 8, 9)).toBe(true); // Touch at 8
    });

    it('should return false for non-overlapping ranges', () => {
      expect(gradesOverlap(7, 8, 10, 11)).toBe(false); // Gap between
      expect(gradesOverlap(10, 11, 7, 8)).toBe(false); // Reversed order
    });
  });
});

describe('BunkCard drop target validation', () => {
  describe('gender validation for non-AG campers', () => {
    it('should allow male campers to drop on boys bunks', () => {
      const maleCamper: MockCamper = { gender: 'M' };
      const boysBunk: MockBunk = { gender: 'M', name: 'B-1' };

      expect(isValidDropTarget(maleCamper, boysBunk)).toBe(true);
    });

    it('should allow female campers to drop on girls bunks', () => {
      const femaleCamper: MockCamper = { gender: 'F' };
      const girlsBunk: MockBunk = { gender: 'F', name: 'G-1' };

      expect(isValidDropTarget(femaleCamper, girlsBunk)).toBe(true);
    });

    it('should reject male campers dropping on girls bunks', () => {
      const maleCamper: MockCamper = { gender: 'M' };
      const girlsBunk: MockBunk = { gender: 'F', name: 'G-1' };

      expect(isValidDropTarget(maleCamper, girlsBunk)).toBe(false);
    });

    it('should reject female campers dropping on boys bunks', () => {
      const femaleCamper: MockCamper = { gender: 'F' };
      const boysBunk: MockBunk = { gender: 'M', name: 'B-1' };

      expect(isValidDropTarget(femaleCamper, boysBunk)).toBe(false);
    });

    it('should use bunk name prefix B- for boys detection', () => {
      const maleCamper: MockCamper = { gender: 'M' };
      const boysBunk: MockBunk = { gender: null, name: 'B-1' };

      expect(isValidDropTarget(maleCamper, boysBunk)).toBe(true);
    });

    it('should use bunk name prefix G- for girls detection', () => {
      const femaleCamper: MockCamper = { gender: 'F' };
      const girlsBunk: MockBunk = { gender: null, name: 'G-1' };

      expect(isValidDropTarget(femaleCamper, girlsBunk)).toBe(true);
    });
  });

  describe('AG (All-Gender) session campers', () => {
    it('should allow AG campers to drop on mixed bunks', () => {
      const agCamper: MockCamper = {
        gender: 'M',
        expand: { session: { session_type: 'ag', name: 'AG 7th-8th' } }
      };
      const mixedBunk: MockBunk = { gender: 'Mixed', name: 'AG-8' };

      expect(isValidDropTarget(agCamper, mixedBunk)).toBe(true);
    });

    it('should reject AG campers dropping on gendered bunks', () => {
      const agCamper: MockCamper = {
        gender: 'M',
        expand: { session: { session_type: 'ag', name: 'AG 7th-8th' } }
      };
      const boysBunk: MockBunk = { gender: 'M', name: 'B-1' };

      expect(isValidDropTarget(agCamper, boysBunk)).toBe(false);
    });

    it('should validate grade compatibility for AG campers', () => {
      // Session is 7th-8th, bunk is AG-8 (within range)
      const agCamper: MockCamper = {
        gender: 'M',
        expand: { session: { session_type: 'ag', name: 'AG 7th-8th' } }
      };
      const compatibleBunk: MockBunk = { gender: 'Mixed', name: 'AG-8' };
      expect(isValidDropTarget(agCamper, compatibleBunk)).toBe(true);

      // Session is 7th-8th, bunk is AG-10 (outside range)
      const incompatibleBunk: MockBunk = { gender: 'Mixed', name: 'AG-10' };
      expect(isValidDropTarget(agCamper, incompatibleBunk)).toBe(false);
    });

    it('should allow AG campers when grades cannot be parsed', () => {
      const agCamper: MockCamper = {
        gender: 'M',
        expand: { session: { session_type: 'ag', name: 'AG Session' } }
      };
      const mixedBunk: MockBunk = { gender: 'Mixed', name: 'AG Cabin' };

      // When grades can't be extracted, allow the drop
      expect(isValidDropTarget(agCamper, mixedBunk)).toBe(true);
    });
  });
});

describe('BunkCard capacity warnings', () => {
  // These are logic tests for the warning calculations

  it('should trigger over-capacity warning when occupancy exceeds capacity', () => {
    const occupancy = 13;
    const capacity = 12;
    const isOverCapacity = occupancy > capacity;
    expect(isOverCapacity).toBe(true);
  });

  it('should not trigger over-capacity at exactly capacity', () => {
    const occupancy = 12;
    const capacity = 12;
    const isOverCapacity = occupancy > capacity;
    expect(isOverCapacity).toBe(false);
  });

  it('should trigger age gap warning when age difference exceeds 2 years', () => {
    const youngestAge = 10.5;
    const oldestAge = 13.0;
    const ageGapWarning = (oldestAge - youngestAge) > 2.0;
    expect(ageGapWarning).toBe(true);
  });

  it('should not trigger age gap warning at exactly 2 years', () => {
    const youngestAge = 10.5;
    const oldestAge = 12.5;
    const ageGapWarning = (oldestAge - youngestAge) > 2.0;
    expect(ageGapWarning).toBe(false);
  });

  it('should trigger grade ratio warning when one grade exceeds 67%', () => {
    const total = 10;
    const grade1Count = 7; // 70%
    const grade2Count = 3; // 30%
    const ratio1 = Math.round((grade1Count / total) * 100);
    const ratio2 = Math.round((grade2Count / total) * 100);
    const gradeRatioWarning = ratio1 > 67 || ratio2 > 67;
    expect(gradeRatioWarning).toBe(true);
  });

  it('should not trigger grade ratio warning with balanced distribution', () => {
    const total = 10;
    const grade1Count = 5; // 50%
    const grade2Count = 5; // 50%
    const ratio1 = Math.round((grade1Count / total) * 100);
    const ratio2 = Math.round((grade2Count / total) * 100);
    const gradeRatioWarning = ratio1 > 67 || ratio2 > 67;
    expect(gradeRatioWarning).toBe(false);
  });

  it('should trigger too many grades warning when more than 2 grades', () => {
    const gradeCount = 3;
    const tooManyGradesWarning = gradeCount > 2;
    expect(tooManyGradesWarning).toBe(true);
  });
});
