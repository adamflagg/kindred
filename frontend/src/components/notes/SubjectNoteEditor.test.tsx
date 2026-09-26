import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HOUSEHOLD, noteRow, scopeValue } from '../../test/notesScope'
import type { EditorTarget, SubjectNotesScopeValue } from './subjectNotesContext'
import { SubjectNoteEditor } from './SubjectNoteEditor'
import { useSubjectNoteEditor } from './useSubjectNoteEditor'

function target(overrides: Partial<EditorTarget> = {}): EditorTarget {
  return {
    subject: HOUSEHOLD,
    label: 'Johnson',
    surface: 'popover',
    anchorEl: null,
    scenarioId: '',
    ...overrides,
  }
}

function Harness({
  scope,
  editorTarget,
}: {
  scope: SubjectNotesScopeValue
  editorTarget: EditorTarget
}) {
  const model = useSubjectNoteEditor(scope, editorTarget)
  return <SubjectNoteEditor model={model} framed />
}

function renderEditor(
  rows = [] as Array<ReturnType<typeof noteRow>>,
  t = target(),
  overrides = {}
) {
  const scope = scopeValue(rows, {
    scenarioName: 'Draft A',
    scenarioId: t.scenarioId,
    ...overrides,
  })
  render(<Harness scope={scope} editorTarget={t} />)
  return scope
}

describe('SubjectNoteEditor — CampMinder live', () => {
  it('offers only the standard box; no plan link outside a scenario', () => {
    renderEditor()
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
    expect(screen.queryByText(/Note just for/)).not.toBeInTheDocument()
  })

  it('Ctrl+Enter saves the changed layer and closes', async () => {
    const scope = renderEditor()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), {
        key: 'Enter',
        ctrlKey: true,
      })
    })
    expect(scope.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: 'Arriving late Friday.' }, '')
    expect(scope.closeEditor).toHaveBeenCalled()
  })

  it('Save with nothing changed writes nothing', async () => {
    const scope = renderEditor([noteRow(HOUSEHOLD, 'Same')])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scope.save).not.toHaveBeenCalled()
    expect(scope.closeEditor).toHaveBeenCalled()
  })

  it('Cancel discards', () => {
    const scope = renderEditor()
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(scope.save).not.toHaveBeenCalled()
    expect(scope.closeEditor).toHaveBeenCalled()
  })

  it('caps the text at 2000 and counts it', () => {
    renderEditor([noteRow(HOUSEHOLD, 'Twelve chars')])
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('maxLength', '2000')
    expect(screen.getByText('12/2000')).toBeInTheDocument()
  })

  it('keeps the editor open when the save fails', async () => {
    const scope = renderEditor([], target(), { save: vi.fn().mockRejectedValue(new Error('422')) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scope.closeEditor).not.toHaveBeenCalled()
  })
})

describe('SubjectNoteEditor — inside a scenario', () => {
  it('opens on the STANDARD box, with the plan-only box behind a link', () => {
    renderEditor([], target({ scenarioId: 'scnA' }))
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '+ Note just for Draft A' }))
    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveFocus()
  })

  it('opens straight onto the plan box when asked', () => {
    renderEditor([], target({ scenarioId: 'scnA', want: 'plan' }))
    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveFocus()
  })

  it('shows an existing plan-only note expanded, under its Draft pill', () => {
    renderEditor([noteRow(HOUSEHOLD, 'Try Pine', 'scnA')], target({ scenarioId: 'scnA' }))
    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveValue('Try Pine')
    expect(screen.getByText('Draft A')).toBeInTheDocument()
  })

  it('"Keep on all plans" promotes (flushing typed text) and closes', async () => {
    const scope = renderEditor(
      [noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
      target({ scenarioId: 'scnA' })
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'Try Pine, not Oak' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep on all plans' }))
    })
    expect(scope.promote).toHaveBeenCalledWith(HOUSEHOLD, { plan: 'Try Pine, not Oak' }, 'scnA')
    expect(scope.closeEditor).toHaveBeenCalled()
  })

  it('writes the plan layer into the scenario the editor was opened in', async () => {
    const scope = renderEditor([], target({ scenarioId: 'scnA', want: 'plan' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'Only here' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scope.save).toHaveBeenCalledWith(HOUSEHOLD, { plan: 'Only here' }, 'scnA')
  })
})
