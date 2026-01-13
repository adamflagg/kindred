/**
 * Tests for gender utility functions
 */
import { describe, it, expect } from 'vitest';
import {
  getGenderCategory,
  getGenderIdentityDisplay,
  getGenderColorClasses,
  getGenderBadgeClasses,
  canAssignToBunk,
  getVisibleBunks,
  getPronouns,
  getPronounCategory,
  getPronounColorClasses,
  getPronounBadgeClasses,
} from './genderUtils';
import type { Camper } from '../types/app-types';
import type { PersonsResponse } from '../types/pocketbase-types';

describe('getGenderCategory', () => {
  it('should return "boys" for boy/man identity', () => {
    expect(getGenderCategory('boy/man')).toBe('boys');
    expect(getGenderCategory('Boy/Man')).toBe('boys');
    expect(getGenderCategory('BOY/MAN')).toBe('boys');
  });

  it('should return "girls" for girl/woman identity', () => {
    expect(getGenderCategory('girl/woman')).toBe('girls');
    expect(getGenderCategory('Girl/Woman')).toBe('girls');
    expect(getGenderCategory('GIRL/WOMAN')).toBe('girls');
  });

  it('should return "other" for non-binary identities', () => {
    expect(getGenderCategory('non-binary')).toBe('other');
    expect(getGenderCategory('transgender')).toBe('other');
    expect(getGenderCategory('agender')).toBe('other');
    expect(getGenderCategory('prefer not to answer')).toBe('other');
  });

  it('should return "other" for undefined or empty', () => {
    expect(getGenderCategory(undefined)).toBe('other');
    expect(getGenderCategory('')).toBe('other');
  });

  it('should handle whitespace', () => {
    expect(getGenderCategory('  boy/man  ')).toBe('boys');
    expect(getGenderCategory('  girl/woman  ')).toBe('girls');
  });
});

describe('getGenderIdentityDisplay', () => {
  it('should return gender_identity_write_in if present (Camper)', () => {
    const camper = {
      gender_identity_write_in: 'Custom Identity',
      gender_identity_name: 'Other',
    } as Camper;
    expect(getGenderIdentityDisplay(camper)).toBe('Custom Identity');
  });

  it('should return gender_identity_name if no write-in', () => {
    const person = {
      gender_identity_name: 'Non-binary',
    } as PersonsResponse;
    expect(getGenderIdentityDisplay(person)).toBe('Non-binary');
  });

  it('should return "Not specified" if no gender identity', () => {
    const person = {} as PersonsResponse;
    expect(getGenderIdentityDisplay(person)).toBe('Not specified');
  });
});

describe('getGenderColorClasses', () => {
  it('should return blue classes for boys', () => {
    const classes = getGenderColorClasses('boys');
    expect(classes).toContain('bg-blue-100');
    expect(classes).toContain('border-blue-300');
  });

  it('should return pink classes for girls', () => {
    const classes = getGenderColorClasses('girls');
    expect(classes).toContain('bg-pink-100');
    expect(classes).toContain('border-pink-300');
  });

  it('should return purple classes for other', () => {
    const classes = getGenderColorClasses('other');
    expect(classes).toContain('bg-purple-100');
    expect(classes).toContain('border-purple-300');
  });
});

describe('getGenderBadgeClasses', () => {
  it('should return blue badge classes for boys', () => {
    const classes = getGenderBadgeClasses('boys');
    expect(classes).toContain('bg-blue-100');
    expect(classes).toContain('text-blue-800');
  });

  it('should return pink badge classes for girls', () => {
    const classes = getGenderBadgeClasses('girls');
    expect(classes).toContain('bg-pink-100');
    expect(classes).toContain('text-pink-800');
  });

  it('should return purple badge classes for other', () => {
    const classes = getGenderBadgeClasses('other');
    expect(classes).toContain('bg-purple-100');
    expect(classes).toContain('text-purple-800');
  });
});

describe('canAssignToBunk', () => {
  it('should allow M to B- bunks', () => {
    expect(canAssignToBunk('M', 'B-1')).toBe(true);
    expect(canAssignToBunk('M', 'B-12')).toBe(true);
  });

  it('should allow F to G- bunks', () => {
    expect(canAssignToBunk('F', 'G-1')).toBe(true);
    expect(canAssignToBunk('F', 'G-Aleph')).toBe(true);
  });

  it('should allow anyone to AG bunks', () => {
    expect(canAssignToBunk('M', 'AG-1')).toBe(true);
    expect(canAssignToBunk('F', 'AG-2')).toBe(true);
    expect(canAssignToBunk('NB', 'AG-3')).toBe(true);
  });

  it('should not allow M to G- bunks', () => {
    expect(canAssignToBunk('M', 'G-1')).toBe(false);
  });

  it('should not allow F to B- bunks', () => {
    expect(canAssignToBunk('F', 'B-1')).toBe(false);
  });
});

describe('getVisibleBunks', () => {
  const bunks = [
    { name: 'B-1' },
    { name: 'B-2' },
    { name: 'G-1' },
    { name: 'G-2' },
    { name: 'AG-1' },
  ];

  it('should return all bunks when filter is "all"', () => {
    const visible = getVisibleBunks(bunks, 'all');
    expect(visible).toHaveLength(5);
  });

  it('should return B- and AG bunks when filter is "M"', () => {
    const visible = getVisibleBunks(bunks, 'M');
    expect(visible).toHaveLength(3);
    expect(visible.map((b) => b.name)).toContain('B-1');
    expect(visible.map((b) => b.name)).toContain('B-2');
    expect(visible.map((b) => b.name)).toContain('AG-1');
  });

  it('should return G- and AG bunks when filter is "F"', () => {
    const visible = getVisibleBunks(bunks, 'F');
    expect(visible).toHaveLength(3);
    expect(visible.map((b) => b.name)).toContain('G-1');
    expect(visible.map((b) => b.name)).toContain('G-2');
    expect(visible.map((b) => b.name)).toContain('AG-1');
  });
});

describe('getPronouns', () => {
  it('should return pronoun write-in if present', () => {
    const camper = {
      gender_pronoun_write_in: 'xe/xir',
      gender_pronoun_name: 'they/them',
    } as unknown as Camper;
    expect(getPronouns(camper)).toBe('xe/xir');
  });

  it('should return pronoun name if no write-in', () => {
    const camper = {
      gender_pronoun_name: 'she/her',
    } as Camper;
    expect(getPronouns(camper)).toBe('she/her');
  });

  it('should return pronouns field from mapped data', () => {
    const camper = {
      pronouns: 'he/him',
    } as Camper;
    expect(getPronouns(camper)).toBe('he/him');
  });

  it('should return empty string if no pronouns', () => {
    const camper = {} as Camper;
    expect(getPronouns(camper)).toBe('');
  });
});

describe('getPronounCategory', () => {
  it('should return "she_her" for she/her pronouns', () => {
    expect(getPronounCategory('she/her')).toBe('she_her');
    expect(getPronounCategory('She/Her')).toBe('she_her');
    expect(getPronounCategory('she / her')).toBe('she_her');
  });

  it('should return "he_him" for he/him pronouns', () => {
    expect(getPronounCategory('he/him')).toBe('he_him');
    expect(getPronounCategory('He/Him')).toBe('he_him');
    expect(getPronounCategory('he / him')).toBe('he_him');
  });

  it('should return "non_binary" for they/them and other pronouns', () => {
    expect(getPronounCategory('they/them')).toBe('non_binary');
    expect(getPronounCategory('she/they')).toBe('non_binary');
    expect(getPronounCategory('he/they')).toBe('non_binary');
  });

  it('should return "prefer_not_answer" for prefer not to answer', () => {
    expect(getPronounCategory('prefer not to answer')).toBe('prefer_not_answer');
    expect(getPronounCategory('Prefer Not to Answer')).toBe('prefer_not_answer');
  });

  it('should return "prefer_not_answer" for empty', () => {
    expect(getPronounCategory('')).toBe('prefer_not_answer');
  });
});

describe('getPronounColorClasses', () => {
  it('should return blue classes for he_him', () => {
    const classes = getPronounColorClasses('he_him');
    expect(classes).toContain('bg-blue-100');
    expect(classes).toContain('border-blue-300');
  });

  it('should return pink classes for she_her', () => {
    const classes = getPronounColorClasses('she_her');
    expect(classes).toContain('bg-pink-100');
    expect(classes).toContain('border-pink-300');
  });

  it('should return purple classes for non_binary', () => {
    const classes = getPronounColorClasses('non_binary');
    expect(classes).toContain('bg-purple-100');
    expect(classes).toContain('border-purple-300');
  });

  it('should return purple classes for prefer_not_answer', () => {
    const classes = getPronounColorClasses('prefer_not_answer');
    expect(classes).toContain('bg-purple-100');
    expect(classes).toContain('border-purple-300');
  });
});

describe('getPronounBadgeClasses', () => {
  it('should return blue badge classes for he_him', () => {
    const classes = getPronounBadgeClasses('he_him');
    expect(classes).toContain('bg-blue-100');
    expect(classes).toContain('text-blue-800');
  });

  it('should return pink badge classes for she_her', () => {
    const classes = getPronounBadgeClasses('she_her');
    expect(classes).toContain('bg-pink-100');
    expect(classes).toContain('text-pink-800');
  });

  it('should return purple badge classes for non_binary and prefer_not_answer', () => {
    expect(getPronounBadgeClasses('non_binary')).toContain('bg-purple-100');
    expect(getPronounBadgeClasses('prefer_not_answer')).toContain('bg-purple-100');
  });
});
