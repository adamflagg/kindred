import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'

/**
 * Registration › Overview's numbered note on the age chart (owner ruling D-UNCOVERED). The
 * page's notes are numbered in page order: Total Cancelled (1, `OVERVIEW_NOTES`) in the cards
 * above, then this chart, then Summers at Camp (3).
 */
export const AGE_NOTE = 2

export const AGE_NOTES: readonly DefinitionNote[] = [
  {
    n: AGE_NOTE,
    text: 'Age is the season year minus the birth year, so a camper born in late 2016 counts as 10 all through 2026. None means CampMinder has no birthdate for the camper.',
  },
]
