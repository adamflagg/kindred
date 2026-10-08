import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { DefinitionNotes } from '../kit/DefinitionNotes'

/** The foot of any surface that shows money (§4.8): its numbered notes from the registry. */
export function AidDefinitionNotes({
  surface,
  extra = [],
}: {
  surface: string
  /** Notes only this page's rows call for, numbered after the registry's. */
  extra?: readonly string[]
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
  const all = [...notes, ...extra.map((text, i) => ({ n: notes.length + i + 1, text }))]
  return <DefinitionNotes notes={all} />
}
