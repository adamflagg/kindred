import { CS_NOTES, CS_SUP } from './csType'

import type { DefinitionNote } from './notesCap'

export type { DefinitionNote } from './notesCap'

/**
 * Definition notes (§4.8; D20): numbered notes at the bottom of any surface that shows money. The
 * text comes from one server-side registry shared with Reports › Development (PR 3's
 * `useAidDefinitions`). Never on hover.
 */
export function DefinitionNotes({
  notes,
  boldTerm = false,
}: {
  notes: readonly DefinitionNote[]
  /** Also bold a leading "Term:" on notes the server sends no matching term for (the Requests mock). */
  boldTerm?: boolean
}) {
  if (notes.length === 0) return null
  return (
    <ol className={`${CS_NOTES} mt-2.5 ml-0.5 max-w-[1000px] space-y-0.5`}>
      {notes.map((note) => (
        <li key={note.n} className="flex gap-1.5">
          <span className="tabular-nums">{note.n}.</span>{' '}
          <span>
            <NoteWords note={note} boldTerm={boldTerm} />
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * A figure's note number, beside its label: "Decided ¹" (§12: 0.72em, raised, 500). `title` carries
 * the note's words, so the mark explains itself without a trip to the notes.
 */
export function DefRef({ n, title }: { n: number; title?: string | undefined }) {
  return (
    <sup className={title ? `${CS_SUP} cursor-help` : CS_SUP} title={title}>
      {n}
    </sup>
  )
}

/**
 * A note's words with its lead term in bold (design language §12): "Budget:" with its colon, or the term alone
 * where a comma or "=" follows it ("Small groups show as they are, …", "Remaining = …"). A note the server
 * sends no term for bolds its "Term:" only under `boldTerm` (Requests); plain otherwise.
 */
function NoteWords({ note, boldTerm }: { note: DefinitionNote; boldTerm: boolean }) {
  const { term, text } = note
  if (term === undefined || !text.startsWith(term)) {
    return boldTerm ? <TermFirst text={text} /> : <>{text}</>
  }
  const next = text.charAt(term.length)
  if (next === ':') {
    return (
      <>
        <b className="text-foreground font-semibold">{`${term}:`}</b>
        {text.slice(term.length + 1)}
      </>
    )
  }
  // "Cancelled (⊘ before a name): …": the term alone is bold, its aside stays plain.
  if (next === ',' || text.startsWith(' =', term.length) || text.startsWith(' (', term.length)) {
    return (
      <>
        <b className="text-foreground font-semibold">{term}</b>
        {text.slice(term.length)}
      </>
    )
  }
  return boldTerm ? <TermFirst text={text} /> : <>{text}</>
}

/** "Term: the words" with the term in bold; a note with no colon stays plain. */
function TermFirst({ text }: { text: string }) {
  const at = text.indexOf(':')
  if (at <= 0) return <>{text}</>
  return (
    <>
      <b>{text.slice(0, at + 1)}</b>
      {text.slice(at + 1)}
    </>
  )
}
