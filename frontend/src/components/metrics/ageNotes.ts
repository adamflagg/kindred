import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'

/**
 * Registration › Overview's numbered note on the age chart (owner ruling D-UNCOVERED). The page
 * numbers its notes by position in its one list (decision 11), so the number is passed in.
 */
export const AGE_NOTE_TEXT =
  'Age is the season year minus the birth year, so a camper born in late 2016 counts as 10 all through 2026. None means CampMinder has no birthdate for the camper.'

export function ageNote(n: number): DefinitionNote {
  return { n, text: AGE_NOTE_TEXT }
}
