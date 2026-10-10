/**
 * One short line saying which "Program" a screen means (owner ruling, final audit): Requests reads
 * the program the rules price a request under (Quest and TLI fall under Summer), while the Ledger
 * and Grants read the program CampMinder posted the money under. Both are labelled; no row moves.
 */
const WORDS = {
  priced:
    'Program (as priced): the program the rules price the request under, so Quest and TLI fall under Summer. The Ledger and Grants use the program in CampMinder.',
  campminder:
    'Program (in CampMinder): the program the money was posted under, so Quest and Teen Leadership have their own. Requests uses the program the rules price under.',
} as const

export function ProgramWordsNote({ which }: { which: keyof typeof WORDS }) {
  return (
    <p
      data-testid="program-words-note"
      className="text-muted-foreground text-[11.5px] leading-snug"
    >
      {WORDS[which]}
    </p>
  )
}
