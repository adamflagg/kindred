/**
 * The board adapters' hook: a stable `(subject, label) => CardNoteSlots`.
 *
 * The slots object for a subject is built ONCE and cached, so a memo'd card
 * (FamilyCardInner, LodgingUnitCardInner, CamperCard) receives the identical
 * prop on every board render and never re-renders for a note change -- the
 * corner inside it subscribes to SubjectNotesContext on its own. Reads only
 * NotesEnabledContext, so a note save never re-renders the board either.
 */
import { useCallback, useRef } from 'react'

import type { CardNoteSlots } from '../../types/noteSlots'
import type { NoteSubject } from '../../types/subjectNotes'
import { useNotesEnabled } from './subjectNotesContext'
import { subjectKey } from './subjectNoteModel'
import { SubjectNoteCorner } from './SubjectNoteCorner'

export function useNoteSlots(
  card: 'camper' | 'family'
): (subject: NoteSubject | null, label: string) => CardNoteSlots | undefined {
  const enabled = useNotesEnabled()
  const cache = useRef(new Map<string, CardNoteSlots>())
  return useCallback(
    (subject: NoteSubject | null, label: string) => {
      if (!enabled || subject === null) return undefined
      const key = `${subjectKey(subject)}|${label}`
      let slots = cache.current.get(key)
      if (slots === undefined) {
        slots = {
          corner: (
            <SubjectNoteCorner
              subject={subject}
              label={label}
              // FamilyCard's frame is the containing block (its padding box);
              // CamperCard's wrapper div is exactly the card's border box.
              containing={card === 'camper' ? 'border' : 'padding'}
            />
          ),
        }
        cache.current.set(key, slots)
      }
      return slots
    },
    [enabled, card]
  )
}
