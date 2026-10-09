import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { ledgerNoteMarks, TIE_OUT_NOTE, UNCLASSIFIED_NOTE } from './ledgerModel'

/** A footnote mark: its number and the note's words, for the mark's native title. */
export interface NoteMark {
  readonly n: number
  readonly title: string
}

/**
 * Money › Ledger's footnote numbers (§12; mock `noteNo`): the registry's two notes keep their numbers
 * 1 and 2, the page's Unclassified note (only while the season has unclassified money) and the
 * tie-out line follow. Every mark is null until the registry has loaded, so no number is guessed.
 */
export function useLedgerNotes(hasUnclassifiedMoney: boolean): {
  camp: NoteMark | null
  outside: NoteMark | null
  unclassified: NoteMark | null
  tieOut: NoteMark | null
  extra: string[]
} {
  const defs = useAidDefinitions('money-ledger')
  const mark = (key: string): NoteMark | null => {
    const n = defs.numberOf(key)
    const title = defs.entries.find((e) => e.key === key)?.text
    return n === null || title === undefined ? null : { n, title }
  }
  const numbers = ledgerNoteMarks(defs.notes.length, hasUnclassifiedMoney)
  return {
    camp: mark('in_campminder_net'),
    outside: mark('outside_grants_ledger'),
    unclassified:
      numbers.unclassified === null ? null : { n: numbers.unclassified, title: UNCLASSIFIED_NOTE },
    tieOut: numbers.tieOut === null ? null : { n: numbers.tieOut, title: TIE_OUT_NOTE },
    extra: numbers.extra,
  }
}
