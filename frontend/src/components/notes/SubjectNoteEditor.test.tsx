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

describe('SubjectNoteEditor — the scope moves scenarios mid-render (fix round 1)', () => {
  it('freezes the baseline: save writes nothing once the scope has moved to another scenario, if the note is unchanged', async () => {
    const t = target({ scenarioId: 'scnA' })
    const scopeA = scopeValue([noteRow(HOUSEHOLD, 'Try Pine')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    const { rerender } = render(<Harness scope={scopeA} editorTarget={t} />)

    const scopeB = scopeValue([], { scenarioId: 'scnB', scenarioName: 'Draft B' })
    rerender(<Harness scope={scopeB} editorTarget={t} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scopeB.save).not.toHaveBeenCalled()
    expect(scopeB.closeEditor).toHaveBeenCalled()
  })

  it('freezes the baseline: an emptied note still sends the delete, scoped to the scenario the editor was opened in', async () => {
    const t = target({ scenarioId: 'scnA' })
    const scopeA = scopeValue([noteRow(HOUSEHOLD, 'Try Pine')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    const { rerender } = render(<Harness scope={scopeA} editorTarget={t} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '' } })

    const scopeB = scopeValue([], { scenarioId: 'scnB', scenarioName: 'Draft B' })
    rerender(<Harness scope={scopeB} editorTarget={t} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scopeB.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: '' }, 'scnA')
  })

  it('always sends the target scenario to save, never the scope current one, even on the very first render', async () => {
    const t = target({ scenarioId: 'scnA' })
    const scope = scopeValue([noteRow(HOUSEHOLD, 'Try Pine')], {
      scenarioId: '',
      scenarioName: 'Draft A',
    })
    render(<Harness scope={scope} editorTarget={t} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Try Pine, updated' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scope.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: 'Try Pine, updated' }, 'scnA')
  })
})

describe('SubjectNoteEditor — concurrent writes (fix round 1)', () => {
  it('a second save while one is in flight does not double-write', async () => {
    let resolveSave: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    const scope = renderEditor([], target(), { save: vi.fn().mockReturnValue(pending) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Arriving late Friday.' },
    })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), {
        key: 'Enter',
        ctrlKey: true,
      })
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), {
        key: 'Enter',
        ctrlKey: true,
      })
    })
    expect(scope.save).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveSave()
    })
  })

  it('does not save while a promote is in flight', async () => {
    let resolvePromote: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      resolvePromote = resolve
    })
    const scope = renderEditor(
      [noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
      target({ scenarioId: 'scnA' }),
      { promote: vi.fn().mockReturnValue(pending) }
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
      target: { value: 'Try Pine, not Oak' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep on all plans' }))
    })
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note just for this plan' }), {
        key: 'Enter',
        ctrlKey: true,
      })
    })
    expect(scope.save).not.toHaveBeenCalled()
    await act(async () => {
      resolvePromote()
    })
  })
})

describe('SubjectNoteEditor — a baseline refresh in the SAME scenario (final review, C1)', () => {
  it('refreshes an untouched box to the new baseline text, and does not save the stale one', async () => {
    const t = target({ scenarioId: 'scnA' })
    const scopeA = scopeValue([noteRow(HOUSEHOLD, 'old text')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    const { rerender } = render(<Harness scope={scopeA} editorTarget={t} />)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('old text')

    // A refetch lands while nobody has typed into the box: the same scenario,
    // a new row.
    const scopeA2 = scopeValue([noteRow(HOUSEHOLD, 'new text')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    rerender(<Harness scope={scopeA2} editorTarget={t} />)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('new text')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    // Nothing is dirty against the REFRESHED baseline, so a flush (Save, or
    // the panel's unmount flush) must write nothing -- and, in particular,
    // never the stale 'old text' the box would otherwise still be holding.
    expect(scopeA2.save).not.toHaveBeenCalled()
    expect(scopeA2.closeEditor).toHaveBeenCalled()
  })

  it('does NOT clobber text the user has already typed when the baseline moves', async () => {
    const t = target({ scenarioId: 'scnA' })
    const scopeA = scopeValue([noteRow(HOUSEHOLD, 'old text')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    const { rerender } = render(<Harness scope={scopeA} editorTarget={t} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'my draft' },
    })

    const scopeA2 = scopeValue([noteRow(HOUSEHOLD, 'new text')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    rerender(<Harness scope={scopeA2} editorTarget={t} />)
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('my draft')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scopeA2.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: 'my draft' }, 'scnA')
  })

  it('expands the plan box when a plan layer appears on an untouched refresh', () => {
    const t = target({ scenarioId: 'scnA' })
    const scopeA = scopeValue([noteRow(HOUSEHOLD, 'Standard')], {
      scenarioId: 'scnA',
      scenarioName: 'Draft A',
    })
    const { rerender } = render(<Harness scope={scopeA} editorTarget={t} />)
    expect(
      screen.queryByRole('textbox', { name: 'Note just for this plan' })
    ).not.toBeInTheDocument()

    const scopeA2 = scopeValue(
      [noteRow(HOUSEHOLD, 'Standard'), noteRow(HOUSEHOLD, 'Try Pine', 'scnA')],
      { scenarioId: 'scnA', scenarioName: 'Draft A' }
    )
    rerender(<Harness scope={scopeA2} editorTarget={t} />)
    expect(screen.getByRole('textbox', { name: 'Note just for this plan' })).toHaveValue('Try Pine')
  })
})

describe('SubjectNoteEditor — save failure and empty notes (fix round 1)', () => {
  it('keeps the typed text and re-enables Save after a failed save', async () => {
    const scope = renderEditor([], target(), { save: vi.fn().mockRejectedValue(new Error('422')) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('x')
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    expect(scope.closeEditor).not.toHaveBeenCalled()
  })

  it('sends an empty body when an existing standard note is cleared', async () => {
    const scope = renderEditor([noteRow(HOUSEHOLD, 'Try Pine')])
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(scope.save).toHaveBeenCalledWith(HOUSEHOLD, { standard: '' }, '')
  })
})
