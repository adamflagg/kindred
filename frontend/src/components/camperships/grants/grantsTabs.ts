/**
 * Grants' tabs (spec §8.2; grants-v2.html): the purpose line under each tab, in the mock's words. One
 * map, so later PRs swap a tab's body and never its words.
 */
export const GRANTS_TAB_PURPOSE = {
  register: 'Every outside grant in CampMinder this season, plus commitments typed by hand.',
  'needs-attention': 'Grant lines that need a person: pick the camper or fix the setup.',
  expected: 'Grants families say they are applying for, with no CampMinder line yet.',
  grantors:
    'The directory of outside funders, with their terms and the descriptions they post under.',
} as const

export type GrantsTabSlug = keyof typeof GRANTS_TAB_PURPOSE

export const isGrantsTab = (slug: string): slug is GrantsTabSlug => slug in GRANTS_TAB_PURPOSE

/** P-18: Grants has no past date. */
export const GRANTS_LIVE_ONLY = 'Grants shows today: it has no past date.'
