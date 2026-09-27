import { StickyNote } from 'lucide-react'

import type { NoteSubject } from '../../types/subjectNotes'
import { useSubjectNotesScope } from './subjectNotesContext'
import { cornerState, subjectKey } from './subjectNoteModel'

/** "Add note… / Edit note…" in the camper card's right-click menu (spec §10.5). */
export function SubjectNoteMenuItem({ subject, label }: { subject: NoteSubject; label: string }) {
  const scope = useSubjectNotesScope()
  if (scope === null) return null
  const { mode } = cornerState(scope.notesFor(subject))
  return (
    <button
      type="button"
      className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
      onClick={() => {
        // CamperCard already closes its menu on this event.
        window.dispatchEvent(new CustomEvent('closeAllContextMenus'))
        // Anchor to the card's own corner, so the popover sits beside the card.
        const anchorEl = document.querySelector<HTMLElement>(
          `[data-note-corner-for="${subjectKey(subject)}"]`
        )
        scope.openEditor({ subject, label, surface: 'popover', anchorEl })
      }}
    >
      <StickyNote className="h-4 w-4" />
      {mode === 'ghost' ? 'Add note…' : 'Edit note…'}
    </button>
  )
}
