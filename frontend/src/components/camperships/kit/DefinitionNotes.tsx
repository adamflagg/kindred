export interface DefinitionNote {
  readonly n: number
  readonly text: string
}

/**
 * Definition notes (§4.8; D20): numbered notes at the bottom of any surface that shows money. The
 * text comes from one server-side registry shared with Reports › Development (PR 3's
 * `useAidDefinitions`). Never on hover.
 */
export function DefinitionNotes({ notes }: { notes: readonly DefinitionNote[] }) {
  if (notes.length === 0) return null
  return (
    <ol className="text-muted-foreground mt-3 space-y-0.5 text-xs">
      {notes.map((note) => (
        <li key={note.n} className="flex gap-1.5">
          <span className="tabular-nums">{note.n}.</span> <span>{note.text}</span>
        </li>
      ))}
    </ol>
  )
}

/** A figure's note number, beside its label: "Decided ¹". */
export function DefRef({ n }: { n: number }) {
  return <sup className="text-muted-foreground ml-0.5 text-xs">{n}</sup>
}
