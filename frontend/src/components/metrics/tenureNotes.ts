import type { DefinitionNote } from '../camperships/kit/DefinitionNotes'

/**
 * Registration › Overview's numbered note on the Summers at Camp average (decision 12).
 * The page keeps one note list in page order: Total Cancelled is 1 (`OVERVIEW_NOTES`), and this
 * note is 2, listed only when the average exists.
 */
export const TENURE_NOTE = 2

export const TENURE_NOTES: readonly DefinitionNote[] = [
  {
    n: TENURE_NOTE,
    text: "From CampMinder's Years at Camp, which counts summer seasons and not Family Camp years.",
  },
]
