import type { NoteSubject } from '../../types/subjectNotes'

export interface SubjectNoteCornerProps {
  subject: NoteSubject
  label: string
  containing: 'padding' | 'border'
}

/** Replaced by Task 2.6. Renders nothing so Task 2.5's slots can be built and tested. */
export function SubjectNoteCorner(_props: SubjectNoteCornerProps) {
  return null
}
