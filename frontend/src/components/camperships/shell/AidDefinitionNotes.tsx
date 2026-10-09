import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { DefinitionNotes } from '../kit/DefinitionNotes'

/** The foot of any surface that shows money (§4.8): its numbered notes from the registry. */
export function AidDefinitionNotes({
  surface,
  extra = [],
  boldTerm = false,
  appendToLast,
}: {
  surface: string
  /** Notes only this page's rows call for, numbered after the registry's. */
  extra?: readonly string[]
  /** Bold each note's leading "Term:" (Requests; the mock does it there only). */
  boldTerm?: boolean
  /** Words joined onto the LAST registry note (not a note of their own): a persona's one-line caveat. */
  appendToLast?: string
}) {
  const { notes, isPending, error } = useAidDefinitions(surface)
  // A failed refetch keeps the notes already loaded; the message is for when there are none.
  if (error && notes.length === 0) {
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        The definitions for these figures couldn&apos;t load.
      </p>
    )
  }
  if (isPending) return null
  const registry =
    appendToLast === undefined
      ? notes
      : notes.map((note, i) =>
          i === notes.length - 1 ? { ...note, text: `${note.text} ${appendToLast}` } : note
        )
  const all = [...registry, ...extra.map((text, i) => ({ n: notes.length + i + 1, text }))]
  return <DefinitionNotes notes={all} boldTerm={boldTerm} />
}
