import type { Camper } from '../types/app-types';
import type { PersonsResponse } from '../types/pocketbase-types';

/**
 * Categorizes gender identity into one of three groups
 */
export type GenderCategory = 'boys' | 'girls' | 'other';

/**
 * Categorizes pronouns into color groups
 */
export type PronounCategory = 'she_her' | 'he_him' | 'non_binary' | 'prefer_not_answer';

/**
 * Determines the gender category based on gender identity name
 * @param genderIdentity - The gender identity name or write-in value
 * @returns The gender category: 'boys', 'girls', or 'other'
 */
export function getGenderCategory(genderIdentity: string | undefined): GenderCategory {
  if (!genderIdentity) return 'other';
  
  const identity = genderIdentity.toLowerCase().trim();
  
  // Strict matching for boy/man and girl/woman only
  if (identity === 'boy/man') {
    return 'boys';
  }
  
  if (identity === 'girl/woman') {
    return 'girls';
  }
  
  // Everything else is other (transgender, non-binary, agender, prefer not to answer, etc.)
  return 'other';
}

/**
 * Gets the display gender identity for a camper or person
 * @param entity - Camper or Person object
 * @returns The gender identity to display (no fallback to M/F)
 */
export function getGenderIdentityDisplay(entity: Camper | PersonsResponse): string {
  // Check if entity has write-in field (Camper type)
  if ('gender_identity_write_in' in entity && entity.gender_identity_write_in) {
    return entity.gender_identity_write_in;
  }
  
  // Use gender identity name if available
  if (entity.gender_identity_name) {
    return entity.gender_identity_name;
  }
  
  // No gender identity provided
  return 'Not specified';
}

/**
 * Gets the appropriate color classes for a gender category
 * @param category - The gender category
 * @param _genderIdentity - Unused, kept for API compatibility
 * @returns Tailwind color classes for the category
 */
export function getGenderColorClasses(category: GenderCategory, _genderIdentity?: string): string {
  switch (category) {
    case 'boys':
      return 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700';
    case 'girls':
      return 'bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700';
    case 'other':
      return 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700';
  }
}

/**
 * Gets the appropriate badge color classes for a gender category
 * @param category - The gender category
 * @param _genderIdentity - Unused, kept for API compatibility
 * @returns Tailwind badge color classes for the category
 */
export function getGenderBadgeClasses(category: GenderCategory, _genderIdentity?: string): string {
  switch (category) {
    case 'boys':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'girls':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300';
    case 'other':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
  }
}

/**
 * Determines if a camper can be assigned to a specific bunk based on sex
 * @param camperSex - The camper's biological sex from CampMinder (M/F only)
 * @param bunkName - The bunk name (e.g., "B-1", "G-2", "AG-3")
 * @returns Whether the camper can be assigned to the bunk
 */
export function canAssignToBunk(camperSex: string, bunkName: string): boolean {
  const bunkPrefix = bunkName.substring(0, 2).toUpperCase();

  // AG bunks accept everyone
  if (bunkPrefix === 'AG') return true;

  // Boys bunks accept M
  if (bunkPrefix === 'B-' && camperSex === 'M') return true;

  // Girls bunks accept F
  if (bunkPrefix === 'G-' && camperSex === 'F') return true;

  return false;
}

/**
 * Filters bunks based on selected sex filter
 * @param bunks - Array of bunks
 * @param sexFilter - Selected sex filter (M/F/all)
 * @returns Filtered array of bunks
 */
export function getVisibleBunks<T extends { name: string }>(
  bunks: T[],
  sexFilter: string
): T[] {
  if (sexFilter === 'all') {
    return bunks; // Show all bunks
  }
  
  return bunks.filter(bunk => {
    const prefix = bunk.name.substring(0, 2).toUpperCase();
    
    // AG bunks always visible
    if (prefix === 'AG') return true;
    
    // Show appropriate gendered bunks
    if (sexFilter === 'M') return prefix === 'B-';
    if (sexFilter === 'F') return prefix === 'G-';
    
    return true;
  });
}

/**
 * Gets the pronouns for a camper or person
 * @param entity - Camper or Person object
 * @returns The pronouns to use for coloring
 */
export function getPronouns(entity: Camper | PersonsResponse): string {
  // Check for pronoun write-in field
  if ('gender_pronoun_write_in' in entity && entity.gender_pronoun_write_in) {
    return entity.gender_pronoun_write_in;
  }
  
  // Use pronoun name if available
  if ('gender_pronoun_name' in entity && entity.gender_pronoun_name) {
    return entity.gender_pronoun_name;
  }
  
  // Check for pronouns field (from mapped data)
  if ('pronouns' in entity && entity.pronouns) {
    return entity.pronouns;
  }
  
  // No pronouns found
  return '';
}

/**
 * Determines the pronoun category based on pronouns
 * @param pronouns - The pronouns string
 * @returns The pronoun category for coloring
 */
export function getPronounCategory(pronouns: string): PronounCategory {
  if (!pronouns) return 'prefer_not_answer';
  
  const pronounLower = pronouns.toLowerCase();
  
  // Check for she/her
  if (pronounLower === 'she/her' || pronounLower === 'she / her') {
    return 'she_her';
  }
  
  // Check for he/him
  if (pronounLower === 'he/him' || pronounLower === 'he / him') {
    return 'he_him';
  }
  
  // Check for prefer not to answer
  if (pronounLower.includes('prefer not') || pronounLower === 'prefer not to answer') {
    return 'prefer_not_answer';
  }
  
  // Everything else is non-binary (they/them, she/they, he/they, etc.)
  return 'non_binary';
}

/**
 * Gets the appropriate color classes for pronouns (for card backgrounds)
 * @param category - The pronoun category
 * @returns Tailwind color classes for the category
 */
export function getPronounColorClasses(category: PronounCategory): string {
  switch (category) {
    case 'he_him':
      return 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700';
    case 'she_her':
      return 'bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700';
    case 'non_binary':
    case 'prefer_not_answer':
      return 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700';
  }
}

/**
 * Gets the appropriate badge color classes for pronouns
 * @param category - The pronoun category
 * @returns Tailwind badge color classes for the category
 */
export function getPronounBadgeClasses(category: PronounCategory): string {
  switch (category) {
    case 'he_him':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'she_her':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300';
    case 'non_binary':
    case 'prefer_not_answer':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
  }
}