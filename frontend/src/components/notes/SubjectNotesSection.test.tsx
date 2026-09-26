import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useOverlayEscape } from '../../hooks/useOverlayEscape'
import { HOUSEHOLD, NotesScopeFixture, noteRow, scopeValue } from '../../test/notesScope'
import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { SubjectNotesSection } from './SubjectNotesSection'

const panelTarget: EditorTarget = {
  subject: HOUSEHOLD,
  label: 'Johnson',
  surface: 'panel',
  anchorEl: null,
  scenarioId: '',
}

function Panel({
  value,
  onPanelEscape = vi.fn(),
}: {
  value: SubjectNotesScopeValue
  onPanelEscape?: () => void
}) {
  useOverlayEscape(true, onPanelEscape)
  return (
    <NotesScopeFixture value={value}>
      <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
    </NotesScopeFixture>
  )
}

describe('SubjectNotesSection — reading', () => {
  it('is absent until a note exists (the card corner adds the first one)', () => {
    const { container } = render(<Panel value={scopeValue()} />)
    expect(container.querySelector('[data-notes-section]')).toBeNull()
  })

  it('is absent for a viewer without bunking.manage', () => {
    const { container } = render(
      <NotesScopeFixture value={null}>
        <SubjectNotesSection subject={HOUSEHOLD} label="Johnson" look="family" />
      </NotesScopeFixture>
    )
    expect(container.querySelector('[data-notes-section]')).toBeNull()
  })

  it('shows the standard note with no pill, and the plan-only note under its Draft pill', () => {
    render(
      <Panel
        value={scopeValue(
          [noteRow(HOUSEHOLD, 'Grandma comes Saturday.'), noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
          {
            scenarioId: 'scnA',
            scenarioName: 'Draft A',
          }
        )}
      />
    )
    expect(screen.getByRole('heading', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByText('Grandma comes Saturday.').closest('button')).not.toHaveTextContent(
      'Draft A'
    )
    expect(screen.getByText('Try Pine').closest('button')).toHaveTextContent('Draft A')
  })

  it('edits in place: the standard block opens the panel editor; the plan block asks for the plan box', () => {
    const value = scopeValue(
      [noteRow(HOUSEHOLD, 'Grandma comes Saturday.'), noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
      {
        scenarioId: 'scnA',
        scenarioName: 'Draft A',
      }
    )
    render(<Panel value={value} />)
    fireEvent.click(screen.getByText('Grandma comes Saturday.'))
    expect(value.openEditor).toHaveBeenLastCalledWith({
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
    })
    fireEvent.click(screen.getByText('Try Pine'))
    expect(value.openEditor).toHaveBeenLastCalledWith(expect.objectContaining({ want: 'plan' }))
  })

  it('offers the missing layer: "+ Add note for all plans" and "+ Note just for ‹scenario›"', () => {
    render(
      <Panel
        value={scopeValue([noteRow(HOUSEHOLD, 'Try Pine', 'scnA')], {
          scenarioId: 'scnA',
          scenarioName: 'Draft A',
        })}
      />
    )
    expect(screen.getByRole('button', { name: '+ Add note for all plans' })).toBeInTheDocument()
    render(
      <Panel
        value={scopeValue([noteRow(HOUSEHOLD, 'Standard')], {
          scenarioId: 'scnA',
          scenarioName: 'Draft A',
        })}
      />
    )
    expect(screen.getByRole('button', { name: '+ Note just for Draft A' })).toBeInTheDocument()
  })
})

describe('SubjectNotesSection — editing', () => {
  it('remounts the panel editor when the same subject reopens in a different scenario, discarding the stale draft (ruling 1)', () => {
    const scnA: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnA',
    }
    const scnB: EditorTarget = {
      subject: HOUSEHOLD,
      label: 'Johnson',
      surface: 'panel',
      anchorEl: null,
      scenarioId: 'scnB',
    }
    const valueA = scopeValue([noteRow(HOUSEHOLD, 'Plan A', 'scnA')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
      editor: scnA,
    })
    const { rerender } = render(<Panel value={valueA} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'typed in A, unsaved' },
    })

    const valueB = scopeValue([noteRow(HOUSEHOLD, 'Plan B', 'scnB')], {
      scenarioId: 'scnB',
      scenarioName: 'Draft B',
      editor: scnB,
    })
    rerender(<Panel value={valueB} />)

    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveValue('Plan B')
  })

  it('Escape reverts the edit BEFORE the panel’s own Escape closes the panel', () => {
    const onPanelEscape = vi.fn()
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')])
    const { rerender } = render(<Panel value={value} onPanelEscape={onPanelEscape} />)
    // Editing starts in a LATER commit than the panel's own mount, as in the app.
    const editing = { ...value, editor: panelTarget }
    rerender(<Panel value={editing} onPanelEscape={onPanelEscape} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(editing.closeEditor).toHaveBeenCalledWith(panelTarget)
    expect(onPanelEscape).not.toHaveBeenCalled()
    expect(editing.save).not.toHaveBeenCalled()
  })

  it('flushes a pending edit when the panel closes under it', async () => {
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor: panelTarget })
    const { unmount } = render(<Panel value={value} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Standard, and more' },
    })
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(value.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: 'Standard, and more' }, '')
  })

  it('closes a clean editor when the panel closes, so it does not reopen stale', async () => {
    const value = scopeValue([noteRow(HOUSEHOLD, 'Standard')], { editor: panelTarget })
    const { unmount } = render(<Panel value={value} />)
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(value.save).not.toHaveBeenCalled()
    expect(value.closeEditor).toHaveBeenCalledWith(panelTarget)
  })
})
