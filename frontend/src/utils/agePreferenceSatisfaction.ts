/**
 * Age preference satisfaction logic.
 *
 * The user's preference determines what satisfies them:
 * - "prefer older" = OK if has older kids OR all same/higher grade (no younger)
 * - "prefer younger" = OK if has younger kids OR all same/lower grade (no older)
 *
 * This module provides a single source of truth for this logic in TypeScript.
 * The Python equivalent is in bunking/utils/age_preference.py
 */

export interface AgePreferenceSatisfactionResult {
  satisfied: boolean;
  detail: string;
}

/**
 * Check if an age preference request is satisfied.
 *
 * @param requesterGrade - The grade of the camper making the request
 * @param bunkmateGrades - List of grades of all bunkmates (excluding requester)
 * @param preference - "older" or "younger"
 * @returns Object with satisfied boolean and detail message
 *
 * Logic:
 * - "older": PASS if has older (max > requester) OR no younger (min >= requester)
 * - "younger": PASS if has younger (min < requester) OR no older (max <= requester)
 */
export function isAgePreferenceSatisfied(
  requesterGrade: number,
  bunkmateGrades: number[],
  preference: 'older' | 'younger'
): AgePreferenceSatisfactionResult {
  if (bunkmateGrades.length === 0) {
    return { satisfied: false, detail: 'No bunkmates yet' };
  }

  const minGrade = Math.min(...bunkmateGrades);
  const maxGrade = Math.max(...bunkmateGrades);

  if (preference === 'older') {
    const hasOlder = maxGrade > requesterGrade;
    const hasYounger = minGrade < requesterGrade;

    if (hasOlder) {
      return { satisfied: true, detail: `Has older bunkmates (up to grade ${maxGrade})` };
    } else if (!hasYounger) {
      // All bunkmates are same grade or higher - acceptable
      if (minGrade === maxGrade && minGrade === requesterGrade) {
        return { satisfied: true, detail: `All bunkmates are same grade (${minGrade})` };
      } else {
        // istanbul ignore next - mathematically unreachable: when !hasOlder && !hasYounger,
        // all grades must equal requesterGrade, so the above condition is always true
        return {
          satisfied: true,
          detail: `All bunkmates are same grade or older (grades ${minGrade}-${maxGrade})`,
        };
      }
    } else {
      return {
        satisfied: false,
        detail: `Has younger bunkmates (grade ${minGrade}) - conflicts with 'prefer older'`,
      };
    }
  }

  if (preference === 'younger') {
    const hasYounger = minGrade < requesterGrade;
    const hasOlder = maxGrade > requesterGrade;

    if (hasYounger) {
      return { satisfied: true, detail: `Has younger bunkmates (down to grade ${minGrade})` };
    } else if (!hasOlder) {
      // All bunkmates are same grade or lower - acceptable
      if (minGrade === maxGrade && minGrade === requesterGrade) {
        return { satisfied: true, detail: `All bunkmates are same grade (${minGrade})` };
      } else {
        // istanbul ignore next - mathematically unreachable: when !hasYounger && !hasOlder,
        // all grades must equal requesterGrade, so the above condition is always true
        return {
          satisfied: true,
          detail: `All bunkmates are same grade or younger (grades ${minGrade}-${maxGrade})`,
        };
      }
    } else {
      return {
        satisfied: false,
        detail: `Has older bunkmates (grade ${maxGrade}) - conflicts with 'prefer younger'`,
      };
    }
  }

  // TypeScript ensures this is unreachable, but just in case
  return { satisfied: false, detail: `Unknown preference: ${preference}` };
}
