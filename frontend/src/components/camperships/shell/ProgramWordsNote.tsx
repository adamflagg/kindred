/**
 * One short line on the Ledger and Grants saying what their "Program (in CM)" means (owner ruling, ux3 Q2): their
 * key is the program CampMinder posted the money under, which is what "program mismatch" depends on. The words
 * (At Camp, Quests, Teen Programs, ...) are the ones Requests and the Rules card use too.
 */
const WORDS =
  'Program (in CM): the program CampMinder posted the money under, which is what "program mismatch" compares.'

export function ProgramWordsNote() {
  return (
    <p
      data-testid="program-words-note"
      className="text-muted-foreground text-[11.5px] leading-snug"
    >
      {WORDS}
    </p>
  )
}
