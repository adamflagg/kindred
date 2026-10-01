import { useAidDefinitions } from '../../../hooks/camperships/useAidDefinitions'
import { DefinitionNotes } from '../kit/DefinitionNotes'

/** The foot of any surface that shows money (§4.8): its numbered notes from the registry. */
export function AidDefinitionNotes({ surface }: { surface: string }) {
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
  return <DefinitionNotes notes={notes} />
}
