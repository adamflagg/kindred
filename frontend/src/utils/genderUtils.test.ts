/**
 * Tests for gender utility functions
 */
import { describe, it, expect } from 'vitest'
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
  formatGenderFull,
  formatGenderShort,
} from './genderUtils'
import type { Camper } from '../types/app-types'
import type { PersonsResponse } from '../types/pocketbase-types'

describe('getGenderCategory', () => {
  it.each([
    ['boy/man', 'boys'],
    ['Boy/Man', 'boys'],
    ['BOY/MAN', 'boys'],
    ['girl/woman', 'girls'],
    ['Girl/Woman', 'girls'],
    ['GIRL/WOMAN', 'girls'],
    ['non-binary', 'other'],
    ['transgender', 'other'],
    ['agender', 'other'],
    ['prefer not to answer', 'other'],
    [undefined, 'other'],
    ['', 'other'],
    ['  boy/man  ', 'boys'],
    ['  girl/woman  ', 'girls'],
  ])('returns correct category for %s', (input, expected) => {
    expect(getGenderCategory(input as any)).toBe(expected)
  })
})

describe('getGenderIdentityDisplay', () => {
  it('should return gender_identity_write_in if present (Camper)', () => {
    const camper = {
      gender_identity_write_in: 'Custom Identity',
      gender_identity_name: 'Other',
    } as Camper
    expect(getGenderIdentityDisplay(camper)).toBe('Custom Identity')
  })

  it('should return gender_identity_name if no write-in', () => {
    const person = {
      gender_identity_name: 'Non-binary',
    } as PersonsResponse
    expect(getGenderIdentityDisplay(person)).toBe('Non-binary')
  })

  it('should return "Not specified" if no gender identity', () => {
    const person = {} as PersonsResponse
    expect(getGenderIdentityDisplay(person)).toBe('Not specified')
  })
})

describe('getGenderColorClasses', () => {
  it.each([
    ['boys', 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'],
    ['girls', 'bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700'],
    ['other', 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700'],
  ])('returns correct classes for %s', (category, expected) => {
    expect(getGenderColorClasses(category as any)).toBe(expected)
  })
})

describe('getGenderBadgeClasses', () => {
  it.each([
    ['boys', 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'],
    ['girls', 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300'],
    ['other', 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'],
  ])('returns correct badge classes for %s', (category, expected) => {
    expect(getGenderBadgeClasses(category as any)).toBe(expected)
  })
})

describe('canAssignToBunk', () => {
  it('should allow M to B- bunks', () => {
    expect(canAssignToBunk('M', 'B-1')).toBe(true)
    expect(canAssignToBunk('M', 'B-12')).toBe(true)
  })

  it('should allow F to G- bunks', () => {
    expect(canAssignToBunk('F', 'G-1')).toBe(true)
    expect(canAssignToBunk('F', 'G-Aleph')).toBe(true)
  })

  it('should allow anyone to AG bunks', () => {
    expect(canAssignToBunk('M', 'AG-1')).toBe(true)
    expect(canAssignToBunk('F', 'AG-2')).toBe(true)
    expect(canAssignToBunk('NB', 'AG-3')).toBe(true)
  })

  it('should not allow M to G- bunks', () => {
    expect(canAssignToBunk('M', 'G-1')).toBe(false)
  })

  it('should not allow F to B- bunks', () => {
    expect(canAssignToBunk('F', 'B-1')).toBe(false)
  })
})

describe('getVisibleBunks', () => {
  const bunks = [
    { name: 'B-1' },
    { name: 'B-2' },
    { name: 'G-1' },
    { name: 'G-2' },
    { name: 'AG-1' },
  ]

  it('should return all bunks when filter is "all"', () => {
    const visible = getVisibleBunks(bunks, 'all')
    expect(visible).toHaveLength(5)
  })

  it('should return B- and AG bunks when filter is "M"', () => {
    const visible = getVisibleBunks(bunks, 'M')
    expect(visible).toHaveLength(3)
    expect(visible.map((b) => b.name)).toContain('B-1')
    expect(visible.map((b) => b.name)).toContain('B-2')
    expect(visible.map((b) => b.name)).toContain('AG-1')
  })

  it('should return G- and AG bunks when filter is "F"', () => {
    const visible = getVisibleBunks(bunks, 'F')
    expect(visible).toHaveLength(3)
    expect(visible.map((b) => b.name)).toContain('G-1')
    expect(visible.map((b) => b.name)).toContain('G-2')
    expect(visible.map((b) => b.name)).toContain('AG-1')
  })
})

describe('getPronouns', () => {
  it('should return pronoun write-in if present', () => {
    const camper = {
      gender_pronoun_write_in: 'xe/xir',
      gender_pronoun_name: 'they/them',
    } as unknown as Camper
    expect(getPronouns(camper)).toBe('xe/xir')
  })

  it('should return pronoun name if no write-in', () => {
    const camper = {
      gender_pronoun_name: 'she/her',
    } as Camper
    expect(getPronouns(camper)).toBe('she/her')
  })

  it('should return pronouns field from mapped data', () => {
    const camper = {
      pronouns: 'he/him',
    } as Camper
    expect(getPronouns(camper)).toBe('he/him')
  })

  it('should return empty string if no pronouns', () => {
    const camper = {} as Camper
    expect(getPronouns(camper)).toBe('')
  })
})

describe('getPronounCategory', () => {
  it.each([
    ['she/her', 'she_her'],
    ['She/Her', 'she_her'],
    ['she / her', 'she_her'],
    ['he/him', 'he_him'],
    ['He/Him', 'he_him'],
    ['he / him', 'he_him'],
    ['they/them', 'non_binary'],
    ['she/they', 'non_binary'],
    ['he/they', 'non_binary'],
    ['prefer not to answer', 'prefer_not_answer'],
    ['Prefer Not to Answer', 'prefer_not_answer'],
    ['', 'prefer_not_answer'],
  ])('returns correct category for %s', (input, expected) => {
    expect(getPronounCategory(input)).toBe(expected)
  })
})

describe('getPronounColorClasses', () => {
  it.each([
    ['he_him', 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'],
    ['she_her', 'bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700'],
    ['non_binary', 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700'],
    [
      'prefer_not_answer',
      'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700',
    ],
  ])('returns correct classes for %s', (category, expected) => {
    expect(getPronounColorClasses(category as any)).toBe(expected)
  })
})

describe('getPronounBadgeClasses', () => {
  it.each([
    ['he_him', 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'],
    ['she_her', 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300'],
    ['non_binary', 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'],
    [
      'prefer_not_answer',
      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    ],
  ])('returns correct badge classes for %s', (category, expected) => {
    expect(getPronounBadgeClasses(category as any)).toBe(expected)
  })
})

describe('formatGenderFull', () => {
  it('maps M to Male', () => {
    expect(formatGenderFull('M')).toBe('Male')
  })

  it('maps F to Female', () => {
    expect(formatGenderFull('F')).toBe('Female')
  })

  it('maps anything else to Non-Binary', () => {
    expect(formatGenderFull('X')).toBe('Non-Binary')
    expect(formatGenderFull(undefined)).toBe('Non-Binary')
    expect(formatGenderFull(null)).toBe('Non-Binary')
    expect(formatGenderFull('')).toBe('Non-Binary')
  })
})

describe('formatGenderShort', () => {
  it('maps M to M', () => {
    expect(formatGenderShort('M')).toBe('M')
  })

  it('maps F to F', () => {
    expect(formatGenderShort('F')).toBe('F')
  })

  it('maps anything else to NB', () => {
    expect(formatGenderShort('X')).toBe('NB')
    expect(formatGenderShort(undefined)).toBe('NB')
    expect(formatGenderShort(null)).toBe('NB')
  })
})
