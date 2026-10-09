export interface DefinitionNote {
  readonly n: number
  readonly text: string
}

/** At most six numbered notes per page view (design-language §12; owner: "way too many footer notes"). */
export const NOTES_CAP = 6

/** True when a page's notes run past the cap: the page should fold or drop some. */
export function notesOverCap(notes: readonly DefinitionNote[]): boolean {
  return notes.length > NOTES_CAP
}
