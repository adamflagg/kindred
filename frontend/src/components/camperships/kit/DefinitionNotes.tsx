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
  /** Bold each note's leading "Term:" (the Requests mock does; no other page's does). */
  boldTerm?: boolean
}) {
  if (notes.length === 0) return null
  return (
    <ol className={`${CS_NOTES} mt-2.5 ml-0.5 max-w-[1000px] space-y-0.5`}>
      {notes.map((note) => (
        <li key={note.n} className="flex gap-1.5">
          <span className="tabular-nums">{note.n}.</span>{' '}
          <span>{boldTerm ? <TermFirst text={note.text} /> : note.text}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * A figure's note number, beside its label: "Decided ¹" (§12: 0.72em, raised, 500). `title` carries
 * the note's words, so the mark explains itself without a trip to the notes.
 */
export function DefRef({ n, title }: { n: number; title?: string }) {
  return (
    <sup className={title ? `${CS_SUP} cursor-help` : CS_SUP} title={title}>
      {n}
    </sup>
  )
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
