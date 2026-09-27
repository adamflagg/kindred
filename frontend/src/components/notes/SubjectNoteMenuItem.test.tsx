import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotesScopeFixture, PERSON, noteRow, scopeValue } from '../../test/notesScope'
import { SubjectNoteMenuItem } from './SubjectNoteMenuItem'
import { subjectKey } from './subjectNoteModel'

describe('SubjectNoteMenuItem', () => {
  it('says "Add note…" with no note and "Edit note…" with one', () => {
    const { rerender } = render(
      <NotesScopeFixture value={scopeValue()}>
        <SubjectNoteMenuItem subject={PERSON} label="Emma Johnson" />
      </NotesScopeFixture>
    )
    expect(screen.getByRole('button', { name: 'Add note…' })).toBeInTheDocument()
    rerender(
      <NotesScopeFixture value={scopeValue([noteRow(PERSON, 'Lower bunk please.')])}>
        <SubjectNoteMenuItem subject={PERSON} label="Emma Johnson" />
      </NotesScopeFixture>
    )
    expect(screen.getByRole('button', { name: 'Edit note…' })).toBeInTheDocument()
  })

  it('closes the menu and opens the popover on the card’s own corner', () => {
    const value = scopeValue()
    const corner = document.createElement('span')
    corner.setAttribute('data-note-corner-for', subjectKey(PERSON))
    document.body.appendChild(corner)
    const closeAll = vi.fn()
    window.addEventListener('closeAllContextMenus', closeAll)
    try {
      render(
        <NotesScopeFixture value={value}>
          <SubjectNoteMenuItem subject={PERSON} label="Emma Johnson" />
        </NotesScopeFixture>
      )
      fireEvent.click(screen.getByRole('button', { name: 'Add note…' }))
      expect(closeAll).toHaveBeenCalled()
      expect(value.openEditor).toHaveBeenCalledWith({
        subject: PERSON,
        label: 'Emma Johnson',
        surface: 'popover',
        anchorEl: corner,
      })
    } finally {
      window.removeEventListener('closeAllContextMenus', closeAll)
      corner.remove()
    }
  })

  it('renders nothing without bunking.manage', () => {
    const { container } = render(
      <NotesScopeFixture value={null}>
        <SubjectNoteMenuItem subject={PERSON} label="Emma Johnson" />
      </NotesScopeFixture>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
