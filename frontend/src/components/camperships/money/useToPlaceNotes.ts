import { useMemo } from 'react'

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
  const { notes, entries } = useAidDefinitions('money-to-place')
  // Memoised on the registry's own (memoised) arrays: the columns that carry these marks are a memo
  // dependency of the table, so a fresh object each render would rebuild them every render.
  return useMemo((): ToPlaceMarks => {
    const mark = (key: string): NoteMark | null => {
      const at = entries.findIndex((e) => e.key === key)
      const n = notes[at]?.n
      const title = entries[at]?.text
      return at < 0 || n === undefined || title === undefined ? null : { n, title }
    }
    return {
      candidates: mark('not_yet_in_campminder'),
      suggestion: mark('to_place_suggestion'),
      confirm: mark('placement_tick'),
      posted: mark('posted'),
    }
  }, [notes, entries])
}
