import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'

/**
 * Registration › Overview's numbered note on the Summers at Camp average (decision 12). The page
 * numbers its notes by position in its one list (decision 11), so the number is passed in.
 */
export const TENURE_NOTE_TEXT =
  "From CampMinder's Years at Camp, which counts summer seasons and not Family Camp years."

export function tenureNote(n: number): DefinitionNote {
  return { n, text: TENURE_NOTE_TEXT }
}
