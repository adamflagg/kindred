import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'

/** A footnote mark: its number and the note's words, for the mark's native title. */
export interface NoteMark {
  readonly n: number
  readonly title: string
}

export interface ToPlaceMarks {
  /** Could belong to¹ (Not yet in CampMinder). */
  readonly candidates: NoteMark | null
  /** Suggestion². */
  readonly suggestion: NoteMark | null
  /** What Confirm does³ (Placing checks Posted). */
  readonly confirm: NoteMark | null
  /** "marks the round Posted⁴" in the callout. */
  readonly posted: NoteMark | null
}

/**
 * To place's footnote marks (design-language §12; mock `NOTES`): each header and the callout carry the
 * number the registry gives its note, with the note's words as the mark's title. Null until the
 * registry has loaded, so no number is guessed.
 */
export function useToPlaceNotes(): ToPlaceMarks {
  const defs = useAidDefinitions('money-to-place')
  const mark = (key: string): NoteMark | null => {
    const n = defs.numberOf(key)
    const title = defs.entries.find((e) => e.key === key)?.text
    return n === null || title === undefined ? null : { n, title }
  }
  return {
    candidates: mark('not_yet_in_campminder'),
    suggestion: mark('to_place_suggestion'),
    confirm: mark('placement_tick'),
    posted: mark('posted'),
  }
}
